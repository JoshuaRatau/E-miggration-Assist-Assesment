/**
 * Milestone 4 Phase 13A — client portal ACTIVATION readiness (preparation
 * only, READ-ONLY, ZERO side effects).
 *
 * This codebase has no authenticated client accounts today — client-facing
 * access is an unauthenticated reference-number lookup (see /status +
 * GET /api/public/status/:referenceNumber). Phase 13A adds the *scaffolding*
 * to represent whether a converted case is ready for a (future) client-portal
 * activation, WITHOUT creating credentials, sending notifications, or exposing
 * anything to clients.
 *
 * `lead_cases.portal_status` is the persisted activation lifecycle a FUTURE
 * phase's real actions will mutate. Until then it defaults to 'not_prepared'
 * for every case, so this module DERIVES a display-only readiness assessment
 * from the case's current signals — it never writes anything.
 */

export type ClientPortalStatus =
  | "not_prepared"
  | "ready_to_activate"
  | "activated"
  | "manual_review_required";

export interface CasePortalSignals {
  /** The persisted `lead_cases.portal_status` (default 'not_prepared'). */
  portalStatus: string | null;
  /** The persisted `lead_cases.workflow_status` (Phase 12C). */
  workflowStatus: string | null;
}

/**
 * Resolve the effective, display-only client-portal status for a converted
 * case. Pure function — no DB, no network, no mutation.
 *
 * Precedence:
 *   1. An EXPLICIT persisted lifecycle state always wins — once a future
 *      real action stamps the case ('activated' / 'ready_to_activate' /
 *      'manual_review_required'), that is authoritative and is surfaced as-is.
 *   2. Otherwise (the 'not_prepared' default, i.e. no prep action has run) we
 *      derive a display assessment from the case's workflow state:
 *        - workflow 'review_required' ⇒ 'manual_review_required' (a human must
 *          resolve the workflow before the portal can even be prepared)
 *        - workflow 'assigned' / 'unassigned' / unknown ⇒ 'not_prepared'
 *
 * IMPORTANT (Phase 13B): an 'assigned' workflow derives to 'not_prepared', NOT
 * 'ready_to_activate'. Readiness is no longer *inferred* from the workflow —
 * it is an EXPLICIT persisted state that the "Prepare Client Portal" admin
 * action stamps (see prepareCasePortal). An assigned-but-unprepared case is
 * therefore 'not_prepared' (eligible, but the admin hasn't acted yet); it only
 * becomes 'ready_to_activate' once that action persists it. This keeps the
 * indicator honest and lets the UI enable the Prepare button for exactly the
 * eligible-but-unprepared cases.
 *
 * This derivation is READ-ONLY and does NOT change workflow assignment logic —
 * it only reflects existing state.
 */
export function deriveClientPortalStatus(
  signals: CasePortalSignals,
): ClientPortalStatus {
  const stored = signals.portalStatus;
  if (stored === "activated") return "activated";
  if (stored === "ready_to_activate") return "ready_to_activate";
  if (stored === "manual_review_required") return "manual_review_required";

  // stored === 'not_prepared' (or unknown legacy) → derive from workflow.
  // A case is only 'ready_to_activate' once the explicit prepare action has
  // persisted it — never inferred from an assigned workflow alone.
  switch (signals.workflowStatus) {
    case "review_required":
      return "manual_review_required";
    default:
      return "not_prepared";
  }
}
