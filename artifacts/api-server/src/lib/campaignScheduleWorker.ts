import { and, lte, eq, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  leadAuditTable,
} from "@workspace/db";
import { logger } from "./logger";
import { dispatchClaimedCampaign } from "./campaignDispatch";
import { isQueueReady } from "./queue";

// Phase 6D-3B — scheduled-send worker.
//
// Single-replica, in-process. Tick every 30s. Atomically claims any
// campaign whose status='scheduled' AND scheduled_at<=now() and flips
// it to 'sending' before invoking the shared dispatch helper. The
// atomic UPDATE … RETURNING is the lock — even if multiple ticks
// overlap (they shouldn't, single-replica) only one wins per campaign.
//
// Failure modes:
//   * Queue not ready (boot race) → skip this tick, retry in 30s.
//     The campaign stays in 'scheduled' state and will be picked up
//     when the queue is up. We do NOT claim → revert because the claim
//     itself burns the scheduled_at trigger.
//   * Dispatch helper returns ok=false → it has already reverted the
//     row to 'draft' (or 'cancelled' on materialisation failure). We
//     log + audit; operator sees the campaign back in draft and can
//     re-edit + reschedule.
//   * Worker exception per campaign → caught + logged; the loop
//     continues so one bad campaign can't poison the tick.

const TICK_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

export function startCampaignScheduleWorker(): void {
  if (timer) return;
  logger.info(
    { tickMs: TICK_MS },
    "Phase 6D-3B campaign schedule worker started",
  );
  // Run once immediately so a campaign whose scheduled_at fired during
  // a deploy gets picked up at boot rather than after the first 30s.
  void runTick();
  timer = setInterval(() => void runTick(), TICK_MS);
}

export function stopCampaignScheduleWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runTick(): Promise<void> {
  if (!isQueueReady()) {
    // Queue still booting; skip this tick. Don't burn the schedule trigger.
    return;
  }
  let claimed: typeof campaignsTable.$inferSelect[];
  try {
    claimed = await db
      .update(campaignsTable)
      .set({ status: "sending", updatedAt: new Date() })
      .where(
        and(
          eq(campaignsTable.status, "scheduled"),
          lte(campaignsTable.scheduledAt, new Date()),
        ),
      )
      .returning();
  } catch (err) {
    logger.error({ err }, "schedule worker: claim query failed");
    return;
  }
  if (claimed.length === 0) return;

  logger.info(
    { count: claimed.length, ids: claimed.map((c) => c.id) },
    "schedule worker: claimed scheduled campaigns",
  );

  for (const campaign of claimed) {
    try {
      const outcome = await dispatchClaimedCampaign({
        campaign,
        log: logger,
      });
      // System-actor audit row. We use a direct insert (not writeAudit)
      // because writeAudit needs a request context — and there is none
      // for a scheduler tick. actor_user_id is null; actor_token_hash
      // is a sentinel literal so the row is identifiable as system-fired.
      await db.insert(leadAuditTable).values({
        action: outcome.ok ? "campaign_scheduled_send_started" : "campaign_scheduled_send_failed",
        actorUserId: null,
        actorTokenHash: sql`encode(sha256('system:scheduler'::bytea), 'hex')`,
        before: null,
        after: {
          campaignId: campaign.id,
          scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
          ok: outcome.ok,
          ...(outcome.ok
            ? {
                queued: outcome.queued,
                preSettled: outcome.preSettled,
              }
            : { reason: outcome.reason, cancelled: outcome.cancelled === true }),
        },
      });
      if (!outcome.ok) {
        logger.warn(
          { campaignId: campaign.id, reason: outcome.reason },
          "schedule worker: dispatch refused; campaign reverted",
        );
      }
    } catch (err) {
      // Per-campaign exception. Mark cancelled defensively so the row
      // doesn't get stuck in 'sending' with no recipients.
      logger.error(
        { err, campaignId: campaign.id },
        "schedule worker: per-campaign exception; marking cancelled",
      );
      try {
        await db
          .update(campaignsTable)
          .set({
            status: "cancelled",
            sentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(campaignsTable.id, campaign.id));
      } catch (cancelErr) {
        logger.error(
          { err: cancelErr, campaignId: campaign.id },
          "schedule worker: failed to mark campaign cancelled after exception",
        );
      }
    }
  }
}
