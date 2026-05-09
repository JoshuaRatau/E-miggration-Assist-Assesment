/**
 * Phase 6B — Append a row to the `lead_events` stream.
 *
 * Fire-and-forget at the call site. Errors are logged via the request or
 * singleton logger and never thrown — an event-write failure must NOT
 * mask the underlying business operation.
 *
 * Look up the points value from the rubric BEFORE writing so the
 * historical row is immutable even if the rubric is tweaked later.
 *
 * Typical call sites:
 *   - POST /api/leads (insert) — recordLeadEvent({leadId, type:'lead_created', source:'system'})
 *   - POST /api/leads/:id/finalize — recordLeadEvent({leadId, type:'assessment_completed', source:'system'})
 *   - POST /api/documents — recordLeadEvent({leadId, type:'documents_uploaded', source:'system'})
 *   - PATCH /api/admin/leads/:id (status change) — recordLeadEvent({leadId, type:'status_advanced', source:'operator'})
 *   - PATCH /api/admin/leads/:id (tier change) — recordLeadEvent({leadId, type:'tier_set', source:'operator'})
 *   - POST /api/webhooks/resend (Phase 6E) — recordLeadEvent({leadId, type:'email_opened', source:'webhook'})
 */

import { db, leadEventsTable, prelaunchLeadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { pickRubricForTier, pointsFor, type RubricName } from "./scoringRubrics";

export interface RecordLeadEventArgs {
  leadId: string;
  type: string;
  source?: "system" | "webhook" | "operator";
  payload?: Record<string, unknown> | null;
  /** Override rubric resolution (rare — webhook handlers may force one). */
  rubric?: RubricName;
  /** Override the timestamp (e.g. backfill). Defaults to now() via DB default. */
  occurredAt?: Date;
}

export async function recordLeadEvent(args: RecordLeadEventArgs): Promise<void> {
  try {
    let rubric = args.rubric;
    if (!rubric) {
      // Cheapest-possible lookup: a single column SELECT. The recompute
      // worker re-derives the rubric from intendedTier on every tick so
      // this row's `rubric` value is informational only, not authoritative.
      const [row] = await db
        .select({ intendedTier: prelaunchLeadsTable.intendedTier })
        .from(prelaunchLeadsTable)
        .where(eq(prelaunchLeadsTable.id, args.leadId))
        .limit(1);
      rubric = pickRubricForTier(row?.intendedTier ?? null);
    }

    const points = pointsFor(rubric, args.type);

    await db.insert(leadEventsTable).values({
      leadId: args.leadId,
      type: args.type,
      points,
      rubric,
      payload: (args.payload ?? null) as never,
      source: args.source ?? "system",
      ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
    });
  } catch (err) {
    logger.warn(
      { err, leadId: args.leadId, type: args.type },
      "Failed to write lead_event (non-fatal)",
    );
  }
}
