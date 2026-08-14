/**
 * Pure classification helpers for Meta sync section results.
 * Extracted here so they can be unit-tested without importing any DB
 * or Graph API dependencies.
 */

export type SectionResult = string;

/**
 * A section result that means progress was made (at least one DB row written).
 * "ok"      – all metrics/items synced without errors.
 * "partial:" – some items synced, some failed (see suffix for detail).
 */
export function isProgressResult(v: SectionResult): boolean {
  return v === "ok" || v.startsWith("partial:");
}

/**
 * A section result that represents a genuine failure that the operator should
 * be aware of – i.e. NOT a success, NOT "no data yet", and NOT an unconfigured
 * source.  Covers:
 *   api_error:, permission_missing:, partial:..., token_expired:…,
 *   and sub-prefixed content errors ("fb:api_error:", "ig:…").
 * Excludes:
 *   "ok"           – success
 *   "empty:…"      – API worked, page has no activity / data yet
 *   "no …"         – source not configured (no page / account connected)
 */
export function isGenuineFailure(v: SectionResult): boolean {
  return (
    v !== "ok" &&
    !v.startsWith("empty:") &&
    !v.startsWith("no ") &&
    !v.startsWith("token_expired")
  );
}

/**
 * Derives the run-level sync summary from all section results.
 *
 * @returns
 *   anyProgress  – true when at least one section wrote verified DB rows.
 *   syncWarnings – non-empty string when any section reported a genuine failure,
 *                  even if other sections made progress. Empty string = fully clean run.
 *   runOk        – true only when progress was made AND no section failed.
 *                  Use this as the HTTP/mutation `ok` flag so callers can
 *                  distinguish full success from partial-with-errors.
 */
export function classifySyncResults(sections: Record<string, SectionResult>): {
  anyProgress: boolean;
  syncWarnings: string;
  runOk: boolean;
  allOk: boolean;
  tokenExpired: boolean;
} {
  const values = Object.values(sections);
  const anyProgress = values.some(isProgressResult);
  const allOk = values.every((v) => v === "ok");
  const tokenExpired = values.some((v) => v.startsWith("token_expired"));
  const syncWarnings = values.filter(isGenuineFailure).slice(0, 3).join(" | ");
  const runOk = anyProgress && !syncWarnings;
  return { anyProgress, syncWarnings, runOk, allOk, tokenExpired };
}
