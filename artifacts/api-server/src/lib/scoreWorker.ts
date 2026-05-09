/**
 * Phase 6B — In-process score recompute worker.
 *
 * Single-instance, single-process design. Fine for the current single-
 * replica deploy. If we scale-out we'll add a Postgres advisory lock here.
 *
 * Lifecycle
 * ---------
 *   - On boot:
 *       1. `backfillIfNeeded()` — if `lead_events` is empty AND
 *          `prelaunch_leads` has rows, write one `lead_created` event per
 *          existing lead (using the lead's original `created_at`). This
 *          gives the static rubric a non-zero floor immediately.
 *       2. Run the first tick.
 *   - Every 60s thereafter: `tick()` recomputes any dirty leads.
 *
 * Dirty predicate
 * ---------------
 *   A lead is "dirty" when:
 *     - `lead_score_computed_at IS NULL`, OR
 *     - There exists a `lead_events` row with `occurred_at > computed_at`.
 *
 * Bounded batch (LEAD_BATCH = 200) per tick so a sudden spike in events
 * cannot starve the loop. The next tick picks up where we left off.
 */

import { db, leadEventsTable, prelaunchLeadsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { computeScore } from "./scoreCompute";
import {
  getRubric,
  pickRubricForTier,
  pointsFor,
  type RubricName,
} from "./scoringRubrics";

const TICK_MS = 60_000;
const LEAD_BATCH = 200;

let intervalHandle: NodeJS.Timeout | null = null;
let isTicking = false;

/**
 * If `lead_events` is empty but `prelaunch_leads` has historical rows,
 * write one synthetic `lead_created` event per lead so the worker has
 * something to score. The event's `occurred_at` is the lead's original
 * `created_at`.
 *
 * Crash-safety: the empty-table guard alone is NOT sufficient — a crash
 * mid-insert would leave a partial backfill that the next boot would
 * skip. The whole insert is therefore wrapped in a transaction so a
 * failure rolls back to "still empty" and the next boot retries the
 * full set.
 */
export async function backfillIfNeeded(): Promise<number> {
  return await db.transaction(async (tx) => {
    const [eventCountRow] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(leadEventsTable);
    const eventCount = eventCountRow?.c ?? 0;
    if (eventCount > 0) return 0;

    const leads = await tx
      .select({
        id: prelaunchLeadsTable.id,
        intendedTier: prelaunchLeadsTable.intendedTier,
        createdAt: prelaunchLeadsTable.createdAt,
      })
      .from(prelaunchLeadsTable);

    if (leads.length === 0) return 0;

    const rows = leads.map((l) => {
      const rubric = pickRubricForTier(l.intendedTier);
      return {
        leadId: l.id,
        type: "lead_created",
        points: pointsFor(rubric, "lead_created"),
        rubric,
        source: "system" as const,
        occurredAt: l.createdAt,
      };
    });

    await tx.insert(leadEventsTable).values(rows);
    logger.info(
      { backfilled: rows.length },
      "scoreWorker: backfilled lead_created events",
    );
    return rows.length;
  });
}

interface DirtyLead {
  id: string;
  intendedTier: string | null;
}

async function findDirtyLeads(limit: number): Promise<DirtyLead[]> {
  const rows = await db
    .select({
      id: prelaunchLeadsTable.id,
      intendedTier: prelaunchLeadsTable.intendedTier,
    })
    .from(prelaunchLeadsTable)
    // `>=` (not `>`) to avoid missing events written in the same
    // millisecond as the previous `computed_at`. The worst case is one
    // redundant recompute next tick that produces a byte-identical row;
    // cheap and correct.
    .where(
      sql`${prelaunchLeadsTable.leadScoreComputedAt} IS NULL OR EXISTS (
            SELECT 1 FROM ${leadEventsTable}
            WHERE ${leadEventsTable.leadId} = ${prelaunchLeadsTable.id}
              AND ${leadEventsTable.occurredAt} >= ${prelaunchLeadsTable.leadScoreComputedAt}
          )`,
    )
    .limit(limit);
  return rows.map((r) => ({ id: r.id, intendedTier: r.intendedTier }));
}

/**
 * Recompute a single lead's score. Used by the batch tick and exposed
 * for tests / on-demand recompute paths.
 */
export async function recomputeOne(lead: DirtyLead): Promise<void> {
  const rubricName: RubricName = pickRubricForTier(lead.intendedTier);
  const rubric = getRubric(rubricName);

  const events = await db
    .select()
    .from(leadEventsTable)
    .where(eq(leadEventsTable.leadId, lead.id));

  const { total, breakdown } = computeScore(events, rubric);

  await db
    .update(prelaunchLeadsTable)
    .set({
      leadScore: total,
      leadScoreBreakdown: breakdown,
      leadScoreRubric: rubricName,
      leadScoreComputedAt: new Date(),
    })
    .where(eq(prelaunchLeadsTable.id, lead.id));
}

async function tick(): Promise<void> {
  if (isTicking) {
    // Previous tick still running (slow DB, large batch). Skip this
    // beat — the next tick will pick up the work.
    return;
  }
  isTicking = true;
  const startedAt = Date.now();
  let processed = 0;
  try {
    const dirty = await findDirtyLeads(LEAD_BATCH);
    for (const lead of dirty) {
      try {
        await recomputeOne(lead);
        processed += 1;
      } catch (err) {
        logger.warn(
          { err, leadId: lead.id },
          "scoreWorker: recomputeOne failed (continuing)",
        );
      }
    }
    if (processed > 0) {
      logger.info(
        { processed, ms: Date.now() - startedAt },
        "scoreWorker: tick complete",
      );
    }
  } catch (err) {
    logger.error({ err }, "scoreWorker: tick failed");
  } finally {
    isTicking = false;
  }
}

export async function startScoreWorker(): Promise<void> {
  if (intervalHandle) {
    logger.warn("scoreWorker: already started, ignoring duplicate start");
    return;
  }
  try {
    await backfillIfNeeded();
  } catch (err) {
    logger.error({ err }, "scoreWorker: backfill failed");
  }
  // Run an immediate tick so the first dashboard view doesn't show
  // stale scores. The interval kicks in afterward.
  tick().catch((err) => logger.error({ err }, "scoreWorker: initial tick"));
  intervalHandle = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "scoreWorker: interval tick"));
  }, TICK_MS);
  // Allow node to exit cleanly during tests / signal handling.
  intervalHandle.unref?.();
  logger.info({ tickMs: TICK_MS }, "scoreWorker: started");
}

export function stopScoreWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

