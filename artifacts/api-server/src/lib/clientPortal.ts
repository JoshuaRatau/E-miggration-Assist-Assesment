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
 *      derive a READINESS assessment from the case's workflow state so the
 *      operator can see whether the case *could* be activated:
 *        - workflow 'assigned'        ⇒ 'ready_to_activate'
 *        - workflow 'review_required' ⇒ 'manual_review_required'
 *        - workflow still 'unassigned'/unknown (legacy/pre-12C) ⇒ 'not_prepared'
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
  switch (signals.workflowStatus) {
    case "assigned":
      return "ready_to_activate";
    case "review_required":
      return "manual_review_required";
    default:
      return "not_prepared";
  }
}
