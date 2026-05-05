/**
 * Canonical case lifecycle order.  Mirrors the lead funnel pattern in
 * `classification.ts`: the array is the SOURCE OF TRUTH for both the
 * allowlist (PATCH /admin/cases/:id rejects unknown statuses with 400)
 * and the forward-only guard (PATCH rejects regressions with 409).
 *
 * Stored as plain text in `lead_cases.status` so adding a stage later
 * (e.g. "appeal_submitted") never requires a DB migration — only an
 * append to this array and the matching frontend mirror in
 * `artifacts/emigration-assist/src/lib/caseStatus.ts`.
 */
export const CASE_STATUS_VALUES = [
  "initiated",
  "in_review",
  "documents_requested",
  "submitted",
  "closed",
] as const;

export type CaseStatus = (typeof CASE_STATUS_VALUES)[number];

/**
 * Forward-only guard, matching `canAdvanceStatus` from classification.ts.
 * Permissive for legacy/unknown values so a row with a stale status is
 * never wedged.  Same-status moves are allowed (no-op) so optimistic-UI
 * retries are safe.
 */
export function canAdvanceCaseStatus(
  from: string | null | undefined,
  to: string,
): boolean {
  const fromIdx = from
    ? CASE_STATUS_VALUES.indexOf(from as CaseStatus)
    : -1;
  const toIdx = CASE_STATUS_VALUES.indexOf(to as CaseStatus);
  if (fromIdx === -1 || toIdx === -1) return true;
  return toIdx >= fromIdx;
}
