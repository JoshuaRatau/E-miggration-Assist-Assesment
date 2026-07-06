/**
 * Frontend mirror of the canonical lead-status funnel order.
 *
 * Source of truth: `artifacts/api-server/src/lib/classification.ts`
 * (`LEAD_STATUS_VALUES` + `canAdvanceStatus`).  This file MUST be kept in
 * sync with the server enum — the server enforces the same regression
 * guard on PATCH /api/admin/leads/:id (returns 409 on regression), so
 * any drift here only affects the UX of which dropdown options appear
 * disabled, not data integrity.
 */
export const LEAD_STATUS_ORDER = [
  "new",
  "reviewing",
  "needs_more_information",
  "contacted",
  "engaged",
  "qualified",
  "proposal_sent",
  "ready_for_case",
  "converted",
  "closed",
] as const;

export type LeadStatus = (typeof LEAD_STATUS_ORDER)[number];

/**
 * Returns true when transitioning from `from` to `to` is permitted.
 *
 * Phase 5 §10 — the funnel is now BIDIRECTIONAL. Operators may move a
 * lead forward OR backward to any stage. The single remaining hard
 * invariant is the `converted` predecessor lock: a lead may only enter
 * the `converted` state from `ready_for_case` (or the converted no-op),
 * because converting also creates a `lead_cases` row and we still want
 * that handover to be deliberate. Moving a lead BACK out of `converted`
 * is allowed at the funnel level, but note that the linked case row is
 * not deleted — that is a benign data artefact rather than a bug.
 */
export function canAdvanceStatus(
  from: string | null | undefined,
  to: string,
): boolean {
  if (to === "converted" && from !== "ready_for_case" && from !== "converted") {
    return false;
  }
  return true;
}

/**
 * Strict-forward variant — true only when `to` is STRICTLY later in the
 * funnel than `from`.  Used by the Contact button to decide whether to
 * fire the auto-PATCH (skips the network call when the lead is already
 * at or past the target status).
 */
export function isStrictlyUpstreamOf(
  from: string | null | undefined,
  target: string,
): boolean {
  const fromIdx = from ? LEAD_STATUS_ORDER.indexOf(from as LeadStatus) : -1;
  const targetIdx = LEAD_STATUS_ORDER.indexOf(target as LeadStatus);
  if (fromIdx === -1 || targetIdx === -1) return false;
  return fromIdx < targetIdx;
}

/**
 * Human-friendly label for a status value (handles snake_case → Title Case
 * for `ready_for_case` etc).  Centralised here so dropdowns don't render
 * raw enum values like "ready_for_case".
 */
export function statusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
