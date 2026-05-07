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
  "contacted",
  "awaiting_response",
  "engaged",
  "qualified",
  "proposal_sent",
  "ready_for_case",
  "converted",
  "closed",
] as const;

export type LeadStatus = (typeof LEAD_STATUS_ORDER)[number];

/**
 * Returns true when transitioning from `from` to `to` is a no-op or a
 * forward step in the funnel.  Permissive on unknown statuses so legacy
 * DB values never lock a lead — the server-side allowlist still rejects
 * unknown TARGET statuses with 400 before this guard would matter.
 */
export function canAdvanceStatus(
  from: string | null | undefined,
  to: string,
): boolean {
  const fromIdx = from ? LEAD_STATUS_ORDER.indexOf(from as LeadStatus) : -1;
  const toIdx = LEAD_STATUS_ORDER.indexOf(to as LeadStatus);
  if (fromIdx === -1 || toIdx === -1) return true;
  return toIdx >= fromIdx;
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
