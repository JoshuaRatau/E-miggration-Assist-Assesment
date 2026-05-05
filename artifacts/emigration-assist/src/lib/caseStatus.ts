/**
 * Frontend mirror of the canonical case lifecycle order.
 *
 * Source of truth: `artifacts/api-server/src/lib/caseStatus.ts`
 * (`CASE_STATUS_VALUES` + `canAdvanceCaseStatus`).  This file MUST stay
 * in sync with the server enum — the server enforces the same regression
 * guard on PATCH /api/admin/cases/:caseId (returns 409 on regression),
 * so any drift here only affects which dropdown options appear disabled,
 * not data integrity.
 */
export const CASE_STATUS_ORDER = [
  "initiated",
  "in_review",
  "documents_requested",
  "submitted",
  "closed",
] as const;

export type CaseStatus = (typeof CASE_STATUS_ORDER)[number];

export function canAdvanceCaseStatus(
  from: string | null | undefined,
  to: string,
): boolean {
  const fromIdx = from ? CASE_STATUS_ORDER.indexOf(from as CaseStatus) : -1;
  const toIdx = CASE_STATUS_ORDER.indexOf(to as CaseStatus);
  if (fromIdx === -1 || toIdx === -1) return true;
  return toIdx >= fromIdx;
}

export function caseStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
