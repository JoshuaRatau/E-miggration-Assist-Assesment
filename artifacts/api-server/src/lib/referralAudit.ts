import { db, referralAuditTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Append-only referral tunnel audit (SENDER side).
 *
 * Records the lifecycle of a referral as it moves through the tunnel. Stages
 * mirror the contract's status model:
 *   offered | preview_viewed | accepted | redirected_to_ema | token_consumed |
 *   ema_account_required | ema_account_linked | conflict_check_required |
 *   converted | failed | expired
 *
 * HARD RULE: never write applicant PII here. `detail` may only carry
 * structural facts (ids, statuses, reasons) — no names, emails, phones,
 * passport numbers, or free-text that could identify the applicant.
 */
export type ReferralStage =
  | "offered"
  | "preview_viewed"
  | "accepted"
  | "redirected_to_ema"
  | "token_consumed"
  | "ema_account_required"
  | "ema_account_linked"
  | "conflict_check_required"
  | "converted"
  | "failed"
  | "expired"
  | "consent_recorded"
  | "applicant_pushed";

export async function writeReferralAudit(
  referralId: string,
  stage: ReferralStage,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(referralAuditTable).values({
      referralId,
      stage,
      detail: detail ?? null,
    });
  } catch (err) {
    // Fire-and-forget: an audit-write failure must never mask the underlying
    // tunnel operation.
    logger.error({ err, referralId, stage }, "referral audit write failed");
  }
}
