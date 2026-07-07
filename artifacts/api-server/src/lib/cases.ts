import { db, leadCasesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { resolveWorkflow, type WorkflowCandidate } from "./leadToApplication";

/**
 * Idempotent case creation for a converted lead.
 *
 * Uses INSERT … ON CONFLICT (lead_id) DO NOTHING RETURNING so concurrent
 * PATCHes that simultaneously transition the same lead to "converted"
 * cannot produce duplicate cases — the unique constraint on `lead_id` is
 * the source of truth.  When ON CONFLICT fires, RETURNING is empty, so
 * we follow up with a SELECT to fetch the existing row.
 *
 * Returns the (possibly pre-existing) case row.  Callers must guarantee
 * that `referenceNumber` matches the lead's reference at the moment of
 * conversion — it is snapshotted into the case row as a stable label.
 */
export interface EnsureCaseResult {
  row: typeof leadCasesTable.$inferSelect;
  /**
   * `true` only when THIS call inserted the row. The signal is sourced
   * from the atomic INSERT … ON CONFLICT DO NOTHING RETURNING, so it is
   * race-free: at most one of N concurrent callers will observe
   * `created: true` for a given lead.  Audit hooks must use this flag
   * (NOT a pre-check SELECT) to decide whether to log a `lead_converted`
   * event, otherwise concurrent conversions can both log it.
   */
  created: boolean;
}

export async function ensureCaseForLead(
  leadId: string,
  referenceNumber: string,
): Promise<EnsureCaseResult> {
  const [inserted] = await db
    .insert(leadCasesTable)
    .values({ leadId, referenceNumber })
    .onConflictDoNothing({ target: leadCasesTable.leadId })
    .returning();

  if (inserted) return { row: inserted, created: true };

  // Conflict path — a case already exists for this lead.  Fetch and
  // return it so the caller can surface the same caseId either way.
  const [existing] = await db
    .select()
    .from(leadCasesTable)
    .where(eq(leadCasesTable.leadId, leadId))
    .limit(1);

  if (!existing) {
    // Should be unreachable: ON CONFLICT fired but the row vanished.
    // Surface as 500 to the caller.
    throw new Error(
      `ensureCaseForLead: conflict reported for lead ${leadId} but no case row found`,
    );
  }
  return { row: existing, created: false };
}

/**
 * Milestone 4 Phase 12C — attach the resolved workflow to a freshly created
 * case (or flag it for manual review).
 *
 * Resolves the mapper's `workflowCandidate` against the canonical workflow
 * registry (`resolveWorkflow`):
 *   - recognised key ⇒ set `workflow_key` + `workflow_status='assigned'`;
 *   - unknown / null key ⇒ `workflow_status='review_required'` (never guess).
 *
 * IDEMPOTENT by construction: the UPDATE is guarded on
 * `workflow_status = 'unassigned'`, so only the FIRST call for a case
 * transitions it — re-running conversion can never overwrite an existing
 * attachment nor re-flag a case already under review. `changed` is sourced
 * from the atomic UPDATE … RETURNING (NOT a pre-check SELECT), so at most one
 * of N concurrent callers observes `changed:true` and thus writes the audit
 * row. When the guard fails (already resolved) we read back the current row so
 * the caller can still report the true state.
 */
export type WorkflowAssignmentOutcome =
  | "assigned"
  | "review_required"
  | "unassigned";

export interface WorkflowAssignmentResult {
  outcome: WorkflowAssignmentOutcome;
  /** True only when THIS call transitioned the case out of 'unassigned'. */
  changed: boolean;
  workflowKey: string | null;
  workflowLabel: string | null;
  /** Why this workflow was chosen / why review is needed (from the mapper). */
  reason: string;
}

export async function assignWorkflowForCase(
  caseId: string,
  candidate: WorkflowCandidate,
): Promise<WorkflowAssignmentResult> {
  const definition = resolveWorkflow(candidate.key);

  if (definition) {
    const [updated] = await db
      .update(leadCasesTable)
      .set({
        workflowKey: definition.key,
        workflowStatus: "assigned",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(leadCasesTable.id, caseId),
          eq(leadCasesTable.workflowStatus, "unassigned"),
        ),
      )
      .returning();

    if (updated) {
      return {
        outcome: "assigned",
        changed: true,
        workflowKey: definition.key,
        workflowLabel: definition.label,
        reason: candidate.reason,
      };
    }
    // Already resolved on a prior run — report the persisted state.
    return readWorkflowState(caseId, candidate.reason);
  }

  // No recognised workflow — flag for manual review rather than guessing.
  const [flagged] = await db
    .update(leadCasesTable)
    .set({ workflowStatus: "review_required", updatedAt: sql`now()` })
    .where(
      and(
        eq(leadCasesTable.id, caseId),
        eq(leadCasesTable.workflowStatus, "unassigned"),
      ),
    )
    .returning();

  if (flagged) {
    return {
      outcome: "review_required",
      changed: true,
      workflowKey: null,
      workflowLabel: null,
      reason: candidate.reason,
    };
  }
  return readWorkflowState(caseId, candidate.reason);
}

/** Read the persisted workflow state for a case (idempotent no-op path). */
async function readWorkflowState(
  caseId: string,
  reason: string,
): Promise<WorkflowAssignmentResult> {
  const [row] = await db
    .select({
      workflowKey: leadCasesTable.workflowKey,
      workflowStatus: leadCasesTable.workflowStatus,
    })
    .from(leadCasesTable)
    .where(eq(leadCasesTable.id, caseId))
    .limit(1);

  const status = (row?.workflowStatus ??
    "unassigned") as WorkflowAssignmentOutcome;
  const key = row?.workflowKey ?? null;
  return {
    outcome: status,
    changed: false,
    workflowKey: key,
    workflowLabel: resolveWorkflow(key)?.label ?? null,
    reason,
  };
}

/**
 * Milestone 4 Phase 13B — "Prepare Client Portal": the admin action that marks
 * a converted, workflow-assigned case as `ready_to_activate` for a FUTURE
 * client-portal activation. Preparation ONLY — it flips a single status column
 * and grants NO access, creates NO credentials, and sends NO notifications.
 *
 * Gate (authoritative, server-side): a case may only be prepared once its
 * workflow is `assigned`. A case still `review_required` / `unassigned` is
 * BLOCKED — `portal_status` is left untouched so a human resolves the workflow
 * first (we never prepare a case whose workflow is undecided).
 *
 * State machine (only forward transitions; never downgrades):
 *   not_prepared / manual_review_required → ready_to_activate   (outcome 'prepared')
 *   ready_to_activate  → no-op                                   (outcome 'already_ready')
 *   activated          → no-op (terminal, never downgraded)      (outcome 'already_activated')
 *
 * IDEMPOTENT & race-safe: the whole read-decide-write runs in one transaction
 * with `SELECT … FOR UPDATE` on the case row, and `changed` is true ONLY for the
 * single call that actually transitions the row — so concurrent callers audit
 * `portal_prepared` at most once and re-runs are silent no-ops.
 */
export type PortalPrepareOutcome =
  | "prepared"
  | "already_ready"
  | "already_activated"
  | "blocked_review";

export interface PortalPrepareResult {
  outcome: PortalPrepareOutcome;
  /** True ONLY when THIS call transitioned portal_status → ready_to_activate. */
  changed: boolean;
  /** The persisted portal_status after this call (unchanged on block/no-op). */
  portalStatus: string;
  /** The persisted portal_status BEFORE this call (for accurate audit before). */
  previousPortalStatus: string;
  /** The case's workflow_status at decision time (drives the gate). */
  workflowStatus: string;
}

export async function prepareCasePortal(
  caseId: string,
): Promise<PortalPrepareResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        portalStatus: leadCasesTable.portalStatus,
        workflowStatus: leadCasesTable.workflowStatus,
      })
      .from(leadCasesTable)
      .where(eq(leadCasesTable.id, caseId))
      .for("update")
      .limit(1);

    if (!row) {
      throw new Error(`prepareCasePortal: case ${caseId} not found`);
    }

    const workflowStatus = row.workflowStatus;
    const portalStatus = row.portalStatus;

    // Gate: workflow must be assigned. Otherwise block, leaving state untouched.
    if (workflowStatus !== "assigned") {
      return {
        outcome: "blocked_review",
        changed: false,
        portalStatus,
        previousPortalStatus: portalStatus,
        workflowStatus,
      };
    }

    // Terminal — never downgrade an activated portal.
    if (portalStatus === "activated") {
      return {
        outcome: "already_activated",
        changed: false,
        portalStatus,
        previousPortalStatus: portalStatus,
        workflowStatus,
      };
    }

    // Idempotent — already prepared, no duplicate audit.
    if (portalStatus === "ready_to_activate") {
      return {
        outcome: "already_ready",
        changed: false,
        portalStatus,
        previousPortalStatus: portalStatus,
        workflowStatus,
      };
    }

    // Allowed transition: not_prepared / manual_review_required → ready_to_activate.
    await tx
      .update(leadCasesTable)
      .set({ portalStatus: "ready_to_activate", updatedAt: sql`now()` })
      .where(eq(leadCasesTable.id, caseId));

    return {
      outcome: "prepared",
      changed: true,
      portalStatus: "ready_to_activate",
      previousPortalStatus: portalStatus,
      workflowStatus,
    };
  });
}

/**
 * Phase 13C — activate a PREPARED case's client portal.
 *
 * The controlled follow-up to prepareCasePortal: transitions a case whose
 * portal is `ready_to_activate` (and whose workflow is `assigned`) to
 * `activated`. STILL no client-facing side effects this phase — no credentials
 * are issued, no email/WhatsApp is sent, and nothing is exposed publicly; this
 * flips ONE status column so a FUTURE phase can wire up real client access.
 *
 * Forward-only & terminal: an `activated` case is NEVER downgraded (idempotent
 * success). Activation is gated on BOTH the workflow being `assigned` AND the
 * portal already being `ready_to_activate` — an unprepared case is blocked
 * (`blocked_not_ready`), an undecided workflow is blocked (`blocked_review`);
 * neither writes any state.
 *
 * IDEMPOTENT & race-safe: the whole read-decide-write runs in one transaction
 * with `SELECT … FOR UPDATE` on the case row, and `changed` is true ONLY for the
 * single call that actually transitions the row — so concurrent callers audit
 * `portal_activated` at most once and re-runs are silent no-ops.
 */
export type PortalActivateOutcome =
  | "activated"
  | "already_activated"
  | "blocked_review"
  | "blocked_not_ready";

export interface PortalActivateResult {
  outcome: PortalActivateOutcome;
  /** True ONLY when THIS call transitioned portal_status → activated. */
  changed: boolean;
  /** The persisted portal_status after this call (unchanged on block/no-op). */
  portalStatus: string;
  /** The persisted portal_status BEFORE this call (for accurate audit before). */
  previousPortalStatus: string;
  /** The case's workflow_status at decision time (drives the gate). */
  workflowStatus: string;
}

export async function activateCasePortal(
  caseId: string,
): Promise<PortalActivateResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        portalStatus: leadCasesTable.portalStatus,
        workflowStatus: leadCasesTable.workflowStatus,
      })
      .from(leadCasesTable)
      .where(eq(leadCasesTable.id, caseId))
      .for("update")
      .limit(1);

    if (!row) {
      throw new Error(`activateCasePortal: case ${caseId} not found`);
    }

    const workflowStatus = row.workflowStatus;
    const portalStatus = row.portalStatus;

    // Terminal — already activated, idempotent success, never downgraded and no
    // duplicate audit. Checked FIRST so an activated case always succeeds.
    if (portalStatus === "activated") {
      return {
        outcome: "already_activated",
        changed: false,
        portalStatus,
        previousPortalStatus: portalStatus,
        workflowStatus,
      };
    }

    // Gate: workflow must be assigned. Otherwise block, leaving state untouched.
    if (workflowStatus !== "assigned") {
      return {
        outcome: "blocked_review",
        changed: false,
        portalStatus,
        previousPortalStatus: portalStatus,
        workflowStatus,
      };
    }

    // Gate: portal must be PREPARED first. Block anything not ready_to_activate.
    if (portalStatus !== "ready_to_activate") {
      return {
        outcome: "blocked_not_ready",
        changed: false,
        portalStatus,
        previousPortalStatus: portalStatus,
        workflowStatus,
      };
    }

    // Allowed transition: ready_to_activate → activated.
    await tx
      .update(leadCasesTable)
      .set({ portalStatus: "activated", updatedAt: sql`now()` })
      .where(eq(leadCasesTable.id, caseId));

    return {
      outcome: "activated",
      changed: true,
      portalStatus: "activated",
      previousPortalStatus: portalStatus,
      workflowStatus,
    };
  });
}

/** Touch a case's updatedAt — kept here to centralise the column update. */
export async function touchCaseUpdatedAt(caseId: string): Promise<void> {
  await db
    .update(leadCasesTable)
    .set({ updatedAt: sql`now()` })
    .where(eq(leadCasesTable.id, caseId));
}
