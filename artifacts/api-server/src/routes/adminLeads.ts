import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  prelaunchDocumentsTable,
  leadEngagementsTable,
  caseMessagesTable,
  analyticsEventsTable,
  leadCasesTable as leadCasesQueryRef,
  leadEventsTable,
  leadAuditTable,
  adminUsersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  LEAD_STATUS_VALUES,
  LEAD_PRIORITY_VALUES,
  deriveNextStep,
} from "../lib/classification";

// Phase 6A.5 — Tier-aware lead intent. Allow-list mirrors the values
// documented on the schema column and the frontend `intendedTier.ts`
// helper. Server is the source of truth — any new tier MUST be added
// here AND in the frontend mirror, then codegen run so the OpenAPI Lead
// schema description stays accurate.
const INTENDED_TIER_VALUES = [
  "free",
  "basic",
  "plus",
  "pro",
  "premium",
  "starter_firm",
  "growth_firm",
  "scale_firm",
  "enterprise",
  "concierge",
  "unknown",
] as const;
import { requireAdminToken } from "../lib/adminAuth";
import {
  ensureCaseForLead,
  assignWorkflowForCase,
  prepareCasePortal,
  activateCasePortal,
} from "../lib/cases";
import { deriveClientPortalStatus } from "../lib/clientPortal";
import { buildConversionPreview } from "../lib/leadToApplication";
import { writeAudit, actorTokenHash, type AuditAction } from "../lib/audit";
import { recordLeadEvent } from "../lib/recordLeadEvent";
import { canAdvanceStatus } from "../lib/classification";

const router: IRouter = Router();

function serializeLead(
  row: typeof prelaunchLeadsTable.$inferSelect,
  caseId: string | null = null,
  caseWorkflow: { key: string | null; status: string | null } | null = null,
  casePortalStatusRaw: string | null = null,
) {
  return {
    ...row,
    visaExpiryDate: row.visaExpiryDate ?? null,
    exitDate: row.exitDate ?? null,
    consentTimestamp: row.consentTimestamp
      ? row.consentTimestamp.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // Phase 6B — surface the score-recompute worker's metadata. The Date
    // column is normalised to an ISO-8601 string so it crosses the wire
    // identically to every other timestamp on the Lead payload.
    leadScoreComputedAt: row.leadScoreComputedAt
      ? row.leadScoreComputedAt.toISOString()
      : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
    // Conversion-funnel hint mirrored from leads.ts so PATCH responses stay
    // consistent with GET — see deriveNextStep().
    nextStep: deriveNextStep(row.leadStatus),
    // Lightweight case linkage.  Populated by the lead→case conversion
    // (see ensureCaseForLead) and on read by a LEFT JOIN with lead_cases.
    // null for leads that have not reached `converted` yet.
    caseId,
    // Phase 12C — workflow attachment state on the linked case. null for
    // unconverted leads; on the case it is 'assigned' (workflowKey set),
    // 'review_required', or the legacy 'unassigned' default.
    caseWorkflowKey: caseWorkflow?.key ?? null,
    caseWorkflowStatus: caseWorkflow?.status ?? null,
    // Phase 13A — read-only client-portal readiness. Derived (never written)
    // from the persisted portal_status + workflow state; null until converted.
    casePortalStatus: caseId
      ? deriveClientPortalStatus({
          portalStatus: casePortalStatusRaw,
          workflowStatus: caseWorkflow?.status ?? null,
        })
      : null,
  };
}

/**
 * PATCH /api/admin/leads/:id
 *
 * Admin-only inline CRM update endpoint.  Mutates ONLY the operator-managed
 * fields: status, priority, notes.  Every other column is preserved.
 *
 * Auth: x-admin-token header must equal ADMIN_EMAIL_TOKEN (server-only env).
 *       The endpoint fails closed (503) if the env var is unset.
 *
 * Body: any subset of { status, priority, notes } — at least one required.
 *   - status   ∈ new | reviewing | contacted | qualified |
 *               ready_for_case | converted | closed
 *               (forward-only — regression rejected with 409, see below)
 *   - priority ∈ high | medium | low
 *   - notes    ∈ string | null
 *
 * Funnel-regression guard: when `status` is in the patch, the requested
 * value is compared to the lead's CURRENT status using `canAdvanceStatus`.
 * Any backwards transition is rejected with HTTP 409 so the funnel can
 * never regress (e.g. "qualified" → "contacted" is blocked).  Same-status
 * PATCHes are allowed as no-ops so retries from optimistic UI are safe.
 *
 * Analytics: emits a server-side `admin.lead_updated` event with NO PII —
 * only `{ leadId, fieldsUpdated: [...] }`.
 */
router.patch("/admin/leads/:id", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const updates: Partial<typeof prelaunchLeadsTable.$inferInsert> = {};
  const fieldsUpdated: string[] = [];
  let requestedStatus: string | null = null;
  // Resolved display name of the NEW assignee (null when clearing). Captured
  // during validation so the audit row can render "assigned to <name>"
  // without a second lookup. See the assignedTo block below.
  let assignedToName: string | null = null;
  // Activity status of the NEW assignee (null when clearing or not touched).
  // Used below to reject *re-*assignment to a deactivated user while still
  // allowing an already-assigned inactive owner to be preserved on an
  // unrelated PATCH. See the guard after the BEFORE snapshot.
  let pendingAssigneeActive: boolean | null = null;

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const v = body.status;
    if (typeof v !== "string" || !LEAD_STATUS_VALUES.includes(v as never)) {
      return res.status(400).json({
        error: `status must be one of: ${LEAD_STATUS_VALUES.join(", ")}`,
      });
    }
    updates.leadStatus = v;
    fieldsUpdated.push("status");
    requestedStatus = v;
  }

  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    const v = body.priority;
    if (typeof v !== "string" || !LEAD_PRIORITY_VALUES.includes(v as never)) {
      return res.status(400).json({
        error: `priority must be one of: ${LEAD_PRIORITY_VALUES.join(", ")}`,
      });
    }
    updates.leadPriority = v;
    fieldsUpdated.push("priority");
  }

  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    const v = body.notes;
    if (v !== null && typeof v !== "string") {
      return res
        .status(400)
        .json({ error: "notes must be a string or null" });
    }
    updates.adminNotes = v;
    fieldsUpdated.push("notes");
  }

  // Phase 6A.5 — intendedTier is optional on PATCH. Nullable: explicit null
  // clears a previously-set tier (e.g. operator decides the lead doesn't
  // fit any commercial tier and re-routes to a manual workflow).
  if (Object.prototype.hasOwnProperty.call(body, "intendedTier")) {
    const v = body.intendedTier;
    if (v !== null) {
      if (
        typeof v !== "string" ||
        !INTENDED_TIER_VALUES.includes(v as never)
      ) {
        return res.status(400).json({
          error: `intendedTier must be null or one of: ${INTENDED_TIER_VALUES.join(", ")}`,
        });
      }
    }
    updates.intendedTier = v;
    fieldsUpdated.push("intendedTier");
  }

  // Phase 11C — lead ownership. `assignedTo` is a soft-ref to admin_users.id
  // (no FK). Nullable: explicit null clears the assignment. When non-null we
  // verify the referenced admin user actually exists so a stale/garbage uuid
  // can't be persisted — returning 400 rather than silently storing a
  // dangling reference. The resolved display name is captured for the audit.
  if (Object.prototype.hasOwnProperty.call(body, "assignedTo")) {
    const v = body.assignedTo;
    if (v !== null && typeof v !== "string") {
      return res.status(400).json({
        error: "assignedTo must be an admin user id (string) or null",
      });
    }
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length === 0) {
        return res.status(400).json({
          error: "assignedTo must be a non-empty admin user id or null",
        });
      }
      const [assignee] = await db
        .select({
          id: adminUsersTable.id,
          email: adminUsersTable.email,
          displayName: adminUsersTable.displayName,
          isActive: adminUsersTable.isActive,
        })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, trimmed))
        .limit(1);
      if (!assignee) {
        return res.status(400).json({
          error: "assignedTo does not reference a known admin user",
        });
      }
      updates.assignedTo = trimmed;
      assignedToName = assignee.displayName ?? assignee.email;
      pendingAssigneeActive = assignee.isActive;
    } else {
      updates.assignedTo = null;
    }
    fieldsUpdated.push("assignedTo");
  }

  // Phase 11D — next follow-up. `nextFollowUpAt` reuses the existing timestamp
  // column (date + optional time collapsed into one instant by the client);
  // explicit null clears the follow-up. `followUpNote` is an optional free-text
  // note that rides alongside it. The follow-up OWNER is derived from the
  // lead's `assignedTo` — there is no separate owner field. The scheduled /
  // updated / removed distinction is resolved from the before/after diff after
  // the UPDATE; "completed" is a dedicated route (has different side effects).
  if (Object.prototype.hasOwnProperty.call(body, "nextFollowUpAt")) {
    const v = body.nextFollowUpAt;
    if (v === null) {
      updates.nextFollowUpAt = null;
    } else if (typeof v === "string") {
      const parsed = new Date(v);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: "nextFollowUpAt must be an ISO date-time string or null",
        });
      }
      updates.nextFollowUpAt = parsed;
    } else {
      return res.status(400).json({
        error: "nextFollowUpAt must be an ISO date-time string or null",
      });
    }
    fieldsUpdated.push("nextFollowUpAt");
  }

  if (Object.prototype.hasOwnProperty.call(body, "followUpNote")) {
    const v = body.followUpNote;
    if (v !== null && typeof v !== "string") {
      return res
        .status(400)
        .json({ error: "followUpNote must be a string or null" });
    }
    if (typeof v === "string" && v.length > 2000) {
      return res
        .status(400)
        .json({ error: "followUpNote exceeds 2000 characters" });
    }
    // Normalise empty/whitespace-only notes to null so a blank field doesn't
    // persist an empty string (keeps "has a note" checks simple downstream).
    const trimmed = typeof v === "string" ? v.trim() : null;
    updates.followUpNote = trimmed && trimmed.length > 0 ? trimmed : null;
    fieldsUpdated.push("followUpNote");
  }

  if (fieldsUpdated.length === 0) {
    return res.status(400).json({
      error:
        "Body must include at least one of: status, priority, notes, intendedTier, assignedTo, nextFollowUpAt, followUpNote",
    });
  }

  updates.updatedAt = new Date();

  // Capture the BEFORE snapshot for the audit trail. Racy w.r.t. the
  // atomic UPDATE below (a concurrent writer could land between the
  // SELECT and the UPDATE), but the audit row is observational so the
  // small window is acceptable. The funnel-regression guard remains in
  // the UPDATE's WHERE clause and is the actual correctness boundary.
  const [before] = await db
    .select({
      leadStatus: prelaunchLeadsTable.leadStatus,
      leadPriority: prelaunchLeadsTable.leadPriority,
      adminNotes: prelaunchLeadsTable.adminNotes,
      intendedTier: prelaunchLeadsTable.intendedTier,
      assignedTo: prelaunchLeadsTable.assignedTo,
      nextFollowUpAt: prelaunchLeadsTable.nextFollowUpAt,
      followUpNote: prelaunchLeadsTable.followUpNote,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

  // Phase 11D invariant — a follow-up note may never outlive its due date. If
  // the follow-up ends up cleared after this PATCH (either explicitly nulled in
  // this request, or already absent and only a note was sent), force-clear the
  // note too. Keeps state strict (no orphaned note) and prevents a misleading
  // `lead_followup_updated` audit for a note with no scheduled follow-up. The
  // client already enforces this in the UI; this is the authoritative guard.
  const resolvedFollowUpAt = fieldsUpdated.includes("nextFollowUpAt")
    ? (updates.nextFollowUpAt as Date | null)
    : (before?.nextFollowUpAt ?? null);
  if (!resolvedFollowUpAt) {
    const noteAlready = before?.followUpNote ?? null;
    if (updates.followUpNote != null || noteAlready != null) {
      updates.followUpNote = null;
      if (!fieldsUpdated.includes("followUpNote")) {
        fieldsUpdated.push("followUpNote");
      }
    }
  }

  // Phase 11C — active-assignee rule. The UI only ever offers *active* admins
  // in the assignee picker, so the API mirrors that: you cannot (re)assign a
  // lead to a deactivated user. The one deliberate exception is a no-op — if
  // the lead is ALREADY owned by that (now-inactive) user, an unrelated PATCH
  // that echoes the same assignedTo is allowed through so editing such a lead
  // isn't wedged. Only a genuine *change* to an inactive user is rejected.
  if (
    typeof updates.assignedTo === "string" &&
    pendingAssigneeActive === false &&
    (before?.assignedTo ?? null) !== updates.assignedTo
  ) {
    return res.status(400).json({
      error: "assignedTo must reference an active admin user",
    });
  }

  // Phase 5 §10 — bidirectional pipeline. The funnel is no longer
  // forward-only; operators may move a lead forward OR backward to any
  // stage so a Kanban drag in either direction succeeds. The single
  // remaining hard invariant is the `converted` predecessor lock:
  // entering `converted` still requires the lead to currently sit at
  // `ready_for_case` (or be already converted, for idempotent re-PATCH),
  // because the same PATCH triggers `ensureCaseForLead` and we want
  // case creation to remain a deliberate handover rather than a
  // side-effect of an accidental drag. Moving back OUT of converted is
  // permitted at the funnel level — the previously-created case row is
  // left in place (benign data artefact, see also lib/leadStatus.ts).
  const whereParts = [eq(prelaunchLeadsTable.id, id)];
  if (requestedStatus === "converted") {
    whereParts.push(
      inArray(prelaunchLeadsTable.leadStatus, [
        "ready_for_case",
        "converted",
      ]),
    );
  }

  const [updated] = await db
    .update(prelaunchLeadsTable)
    .set(updates)
    .where(and(...whereParts))
    .returning();

  if (!updated) {
    // Zero rows updated — disambiguate 404 (no such lead) from 409
    // (funnel-regression blocked) with a single follow-up read.  The
    // disambiguation read is racy w.r.t. deletion, but that's a benign
    // misclassification (a deleted-mid-PATCH row would surface as 409
    // instead of 404), not a correctness violation.
    if (requestedStatus !== null) {
      const [existing] = await db
        .select({ leadStatus: prelaunchLeadsTable.leadStatus })
        .from(prelaunchLeadsTable)
        .where(eq(prelaunchLeadsTable.id, id))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ error: "Lead not found" });
      }
      return res.status(409).json({
        error:
          `Conversion blocked: cannot move lead from ` +
          `"${existing.leadStatus}" directly to "converted". ` +
          `A lead must first reach "ready_for_case" before conversion ` +
          `(this gates the case-creation handover).`,
      });
    }
    return res.status(404).json({ error: "Lead not found" });
  }

  // Lead → Case conversion (idempotent).  When the lead's effective status
  // after this PATCH is "converted", ensure a lead_cases row exists.  We
  // call this on EVERY converted-status patch (not just status-changing
  // ones) so a notes/priority-only edit on an already-converted lead still
  // surfaces the linked caseId in the response.  ensureCaseForLead is
  // safe to call repeatedly — the unique (lead_id) constraint guarantees
  // no duplicate cases can ever be created.
  let caseId: string | null = null;
  let caseCreatedThisCall = false;
  let caseWorkflow: { key: string | null; status: string | null } | null = null;
  let casePortalStatusRaw: string | null = null;
  if (updated.leadStatus === "converted") {
    try {
      // ensureCaseForLead's `created` flag is sourced from the atomic
      // INSERT … ON CONFLICT RETURNING, so concurrent PATCHes that both
      // flip the same lead to converted will see `created:true` for at
      // most one of them — eliminating the race that an earlier
      // SELECT-then-INSERT pre-check would have introduced.
      const result = await ensureCaseForLead(
        updated.id,
        updated.referenceNumber,
      );
      caseId = result.row.id;
      caseCreatedThisCall = result.created;
      // Phase 13A — portal_status is never written this phase, so the case
      // row's persisted value (default 'not_prepared') is accurate in BOTH the
      // freshly-created and already-converted branches.
      casePortalStatusRaw = result.row.portalStatus;

      // Phase 12C — the PATCH path is ALSO a conversion path (dashboard
      // lead-drawer). Attach the resolved workflow ONLY on the call that
      // actually created the case (`result.created`). This keeps every OTHER
      // PATCH on an already-converted lead (a notes / follow-up / assignment
      // edit) side-effect-free — it must NOT re-enter workflow assignment and
      // risk transitioning a legacy `unassigned` case out from under an
      // unrelated edit. That mirrors the POST /convert already-converted
      // short-circuit. Uses the SAME mapper + idempotent assignment as
      // /convert, so no duplicate workflow can ever form.
      if (result.created) {
        const candidate = buildConversionPreview(updated).workflowCandidate;
        const workflow = await assignWorkflowForCase(caseId, candidate);
        caseWorkflow = { key: workflow.workflowKey, status: workflow.outcome };
        if (workflow.changed) {
          void writeAudit({
            req,
            action:
              workflow.outcome === "assigned"
                ? "case_workflow_assigned"
                : "case_workflow_review_required",
            leadId: updated.id,
            caseId,
            before: { workflowStatus: "unassigned", workflowKey: null },
            after: {
              workflowStatus: workflow.outcome,
              workflowKey: workflow.workflowKey,
              workflowLabel: workflow.workflowLabel,
              reason: workflow.reason,
            },
          });
        }
      } else {
        // Already-converted lead being edited for an unrelated reason — surface
        // the PERSISTED workflow state from the existing case row without any
        // write, so the response stays consistent with GET.
        caseWorkflow = {
          key: result.row.workflowKey,
          status: result.row.workflowStatus,
        };
      }
    } catch (err) {
      req.log.error(
        { err, leadId: updated.id },
        "Failed to ensure case for converted lead",
      );
      return res.status(500).json({
        error: "Lead status updated but case creation failed",
      });
    }
  }

  // Audit trail (fire-and-forget). One row per actually-changed field
  // so a single PATCH that flips status + notes produces two audit
  // entries with identical actor + timestamp pairing. The `before`
  // snapshot may be undefined on a brand-new lead that vanished between
  // SELECT and UPDATE — defensively guard with `before?`.
  if (
    fieldsUpdated.includes("status") &&
    before?.leadStatus !== updated.leadStatus
  ) {
    void writeAudit({
      req,
      action: "lead_status_changed",
      leadId: updated.id,
      before: { leadStatus: before?.leadStatus ?? null },
      after: { leadStatus: updated.leadStatus },
    });
    // Phase 6B PR 4 — only forward moves emit a `status_advanced` score
    // event. Operators are allowed to walk the funnel backwards (see
    // bidirectional pipeline note in replit.md) but a regression must
    // not earn additional rubric points. canAdvanceStatus returns true
    // for forward (or same-position) moves; we additionally require a
    // strict change so a no-op PATCH doesn't synthesise an event.
    if (canAdvanceStatus(before?.leadStatus ?? null, updated.leadStatus)) {
      void recordLeadEvent({
        leadId: updated.id,
        type: "status_advanced",
        source: "operator",
        payload: {
          from: before?.leadStatus ?? null,
          to: updated.leadStatus,
        },
      });
    }
  }
  if (
    fieldsUpdated.includes("priority") &&
    before?.leadPriority !== updated.leadPriority
  ) {
    void writeAudit({
      req,
      action: "lead_priority_changed",
      leadId: updated.id,
      before: { leadPriority: before?.leadPriority ?? null },
      after: { leadPriority: updated.leadPriority },
    });
  }
  if (
    fieldsUpdated.includes("notes") &&
    (before?.adminNotes ?? null) !== (updated.adminNotes ?? null)
  ) {
    void writeAudit({
      req,
      action: "lead_notes_changed",
      leadId: updated.id,
      before: { adminNotes: before?.adminNotes ?? null },
      after: { adminNotes: updated.adminNotes ?? null },
    });
  }
  if (
    fieldsUpdated.includes("intendedTier") &&
    (before?.intendedTier ?? null) !== (updated.intendedTier ?? null)
  ) {
    void writeAudit({
      req,
      action: "lead_intended_tier_changed",
      leadId: updated.id,
      before: { intendedTier: before?.intendedTier ?? null },
      after: { intendedTier: updated.intendedTier ?? null },
    });
    // Phase 6B PR 4 — emit `tier_set` whenever the tier moves to a
    // non-null value. Clears (set → null) intentionally do NOT fire the
    // event because there's no positive signal in unclassifying a lead.
    // The `tier_set` rule has `maxOccurrences: 1` in both scoring
    // rubrics, so re-tiering between sales tiers (e.g. starter_firm →
    // growth_firm) won't double-credit the lead — only the first set
    // contributes points. Note that recordLeadEvent re-resolves the
    // rubric from the post-PATCH `intendedTier`, so this row lands in
    // the correct rubric snapshot automatically.
    if (updated.intendedTier !== null) {
      void recordLeadEvent({
        leadId: updated.id,
        type: "tier_set",
        source: "operator",
        payload: {
          from: before?.intendedTier ?? null,
          to: updated.intendedTier,
        },
      });
    }
  }
  if (
    fieldsUpdated.includes("assignedTo") &&
    (before?.assignedTo ?? null) !== (updated.assignedTo ?? null)
  ) {
    // Resolve the PREVIOUS assignee's display name (if any) so the timeline
    // can render "reassigned from X to Y" without the client re-resolving
    // uuids. The new assignee's name was captured during validation.
    let beforeName: string | null = null;
    if (before?.assignedTo) {
      const [prev] = await db
        .select({
          email: adminUsersTable.email,
          displayName: adminUsersTable.displayName,
        })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, before.assignedTo))
        .limit(1);
      beforeName = prev ? (prev.displayName ?? prev.email) : null;
    }
    void writeAudit({
      req,
      action: "lead_assigned_changed",
      leadId: updated.id,
      before: {
        assignedTo: before?.assignedTo ?? null,
        assignedToName: beforeName,
      },
      after: {
        assignedTo: updated.assignedTo ?? null,
        assignedToName,
      },
    });
  }
  // Phase 11D — follow-up audit. A single PATCH can touch the due-date and/or
  // the note; we treat them as one logical "follow-up" change and emit at most
  // ONE audit row, choosing the verb from the before/after due-date transition:
  //   null  → set   ⇒ scheduled
  //   set   → set   ⇒ updated   (date and/or note changed)
  //   set   → null  ⇒ removed
  // "completed" is never emitted here — it's the dedicated /complete route,
  // which also stamps lastContactedAt. The owner is snapshotted (derived from
  // assignedTo) so the timeline can render "for <owner>" without a join.
  if (
    fieldsUpdated.includes("nextFollowUpAt") ||
    fieldsUpdated.includes("followUpNote")
  ) {
    const beforeDue = before?.nextFollowUpAt
      ? before.nextFollowUpAt.toISOString()
      : null;
    const afterDue = updated.nextFollowUpAt
      ? updated.nextFollowUpAt.toISOString()
      : null;
    const beforeNote = before?.followUpNote ?? null;
    const afterNote = updated.followUpNote ?? null;
    const changed = beforeDue !== afterDue || beforeNote !== afterNote;
    if (changed) {
      let action: AuditAction;
      if (beforeDue === null && afterDue !== null) {
        action = "lead_followup_scheduled";
      } else if (beforeDue !== null && afterDue === null) {
        action = "lead_followup_removed";
      } else {
        // both non-null (updated), or a note-only change while due stays null
        action = "lead_followup_updated";
      }
      void writeAudit({
        req,
        action,
        leadId: updated.id,
        before: {
          dueAt: beforeDue,
          note: beforeNote,
          ownerId: before?.assignedTo ?? null,
        },
        after: {
          dueAt: afterDue,
          note: afterNote,
          ownerId: updated.assignedTo ?? null,
        },
      });
    }
  }
  if (caseId !== null && caseCreatedThisCall) {
    void writeAudit({
      req,
      action: "lead_converted",
      leadId: updated.id,
      caseId,
      before: { leadStatus: before?.leadStatus ?? null, caseId: null },
      after: { leadStatus: "converted", caseId },
    });
  }

  // Fire-and-forget analytics. Telemetry minimisation per spec: ONLY the
  // lead id (FK column + payload field) and the names of the updated fields
  // are persisted. The denormalised `reference_number` column is intentionally
  // left NULL on this row so no extra identifier is recorded.
  db.insert(analyticsEventsTable)
    .values({
      eventName: "admin.lead_updated",
      leadId: updated.id,
      payload: { leadId: updated.id, fieldsUpdated },
    })
    .catch((err) =>
      req.log.warn({ err }, "Failed to log admin.lead_updated event"),
    );

  return res.json(
    serializeLead(updated, caseId, caseWorkflow, casePortalStatusRaw),
  );
});

/**
 * POST /api/admin/leads/:id/archive
 *
 * Soft-archive a lead: stamps `archived_at` so the lead drops out of the
 * default funnel/list while preserving the row and all related data. The
 * operation is idempotent — re-archiving an already-archived lead succeeds
 * without writing a second audit row.
 */
router.post("/admin/leads/:id/archive", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  const [before] = await db
    .select({ archivedAt: prelaunchLeadsTable.archivedAt })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!before) return res.status(404).json({ error: "Lead not found" });

  const [updated] = await db
    .update(prelaunchLeadsTable)
    .set({ archivedAt: before.archivedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(prelaunchLeadsTable.id, id))
    .returning();

  if (before.archivedAt === null) {
    void writeAudit({
      req,
      action: "lead_archived",
      leadId: id,
      before: { archivedAt: null },
      after: { archivedAt: updated.archivedAt?.toISOString() ?? null },
    });
  }

  return res.json(serializeLead(updated));
});

/**
 * POST /api/admin/leads/:id/unarchive
 *
 * Restore a soft-archived lead back into the active funnel by clearing
 * `archived_at`. Idempotent — restoring an already-active lead is a no-op
 * success.
 */
router.post("/admin/leads/:id/unarchive", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  const [before] = await db
    .select({ archivedAt: prelaunchLeadsTable.archivedAt })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!before) return res.status(404).json({ error: "Lead not found" });

  const [updated] = await db
    .update(prelaunchLeadsTable)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(prelaunchLeadsTable.id, id))
    .returning();

  if (before.archivedAt !== null) {
    void writeAudit({
      req,
      action: "lead_unarchived",
      leadId: id,
      before: { archivedAt: before.archivedAt.toISOString() },
      after: { archivedAt: null },
    });
  }

  return res.json(serializeLead(updated));
});

/**
 * DELETE /api/admin/leads/:id
 *
 * Permanently delete a lead and its dependent rows (documents, engagements,
 * inbound case messages, score events) in a single transaction. This is
 * destructive and irreversible — the UI gates it behind an explicit
 * confirmation and recommends Archive instead.
 *
 * Hard invariant: a lead that has been CONVERTED to a case cannot be
 * hard-deleted (409). Cases are operational records; the operator must
 * archive the lead instead so the case linkage stays intact. `lead_audit`
 * rows are intentionally NOT deleted — the append-only forensic trail
 * outlives the lead (leadId is a soft reference, so orphaned rows are fine).
 */
router.delete("/admin/leads/:id", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;

  // The lead-exists and no-linked-case checks must happen INSIDE the same
  // transaction as the delete, with a row lock on the lead, otherwise a
  // concurrent "convert to case" PATCH could insert a `lead_cases` row in
  // the window between an outside check and the delete — orphaning the case
  // and violating the hard invariant. `SELECT ... FOR UPDATE` on the lead
  // serialises against the conversion PATCH (which locks the same row when
  // it flips status → converted), so the case re-check below is authoritative.
  const result = await db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(prelaunchLeadsTable)
      .where(eq(prelaunchLeadsTable.id, id))
      .for("update")
      .limit(1);
    if (!lead) return { kind: "not_found" as const };

    const [linkedCase] = await tx
      .select({ id: leadCasesQueryRef.id })
      .from(leadCasesQueryRef)
      .where(eq(leadCasesQueryRef.leadId, id))
      .limit(1);
    if (linkedCase) return { kind: "conflict" as const };

    await tx
      .delete(prelaunchDocumentsTable)
      .where(eq(prelaunchDocumentsTable.leadId, id));
    await tx
      .delete(leadEngagementsTable)
      .where(eq(leadEngagementsTable.leadId, id));
    await tx.delete(caseMessagesTable).where(eq(caseMessagesTable.leadId, id));
    await tx.delete(leadEventsTable).where(eq(leadEventsTable.leadId, id));
    await tx.delete(prelaunchLeadsTable).where(eq(prelaunchLeadsTable.id, id));
    return { kind: "deleted" as const, lead };
  });

  if (result.kind === "not_found")
    return res.status(404).json({ error: "Lead not found" });
  if (result.kind === "conflict") {
    return res.status(409).json({
      error:
        "This lead has been converted to a case and cannot be permanently " +
        "deleted. Archive it instead to keep the case record intact.",
    });
  }

  void writeAudit({
    req,
    action: "lead_deleted",
    leadId: id,
    before: {
      referenceNumber: result.lead.referenceNumber,
      leadStatus: result.lead.leadStatus,
      email: result.lead.email,
    },
    after: null,
  });

  return res.json({ ok: true, id });
});

/**
 * GET /api/admin/leads/:id/events
 *
 * Phase 6B PR 3 — read-only activity feed for the lead-detail Activity
 * panel. Returns the underlying `lead_events` rows that the score
 * recompute worker consumes, ordered newest-first, alongside the lead's
 * current rubric label and most-recent recompute timestamp so the UI
 * can render "static rubric · last computed 3m ago" headers without a
 * second round-trip.
 *
 * Like the existing `/admin/leads/:id/timeline` endpoint, this route is
 * intentionally kept OUT of the OpenAPI spec — the events feed is a
 * sibling resource whose shape may evolve as we add scoring rules.
 * Keeping it dedicated lets us iterate without disturbing the Lead
 * contract.
 */
router.get("/admin/leads/:id/events", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  // Confirm existence + capture the score metadata. 404 here distinguishes
  // a typo'd id from the empty-events case (which is a valid 200 with
  // events: []).
  const [lead] = await db
    .select({
      id: prelaunchLeadsTable.id,
      leadScore: prelaunchLeadsTable.leadScore,
      leadScoreRubric: prelaunchLeadsTable.leadScoreRubric,
      leadScoreComputedAt: prelaunchLeadsTable.leadScoreComputedAt,
      leadScoreBreakdown: prelaunchLeadsTable.leadScoreBreakdown,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const rows = await db
    .select({
      id: leadEventsTable.id,
      type: leadEventsTable.type,
      points: leadEventsTable.points,
      rubric: leadEventsTable.rubric,
      source: leadEventsTable.source,
      occurredAt: leadEventsTable.occurredAt,
    })
    .from(leadEventsTable)
    .where(eq(leadEventsTable.leadId, id))
    .orderBy(desc(leadEventsTable.occurredAt));

  return res.json({
    leadId: lead.id,
    leadScore: lead.leadScore ?? null,
    leadScoreRubric: lead.leadScoreRubric ?? null,
    leadScoreBreakdown: lead.leadScoreBreakdown ?? null,
    leadScoreComputedAt: lead.leadScoreComputedAt
      ? lead.leadScoreComputedAt.toISOString()
      : null,
    events: rows.map((r) => ({
      id: r.id,
      type: r.type,
      points: r.points,
      rubric: r.rubric,
      source: r.source,
      occurredAt: r.occurredAt.toISOString(),
    })),
  });
});

/**
 * Phase 11B — internal-only lead notes.
 *
 * Rather than introduce a duplicate notes store, notes reuse the existing
 * append-only `lead_audit` history mechanism: each note is a
 * `lead_note_added` audit row with the text carried in `after.note`. This
 * means notes automatically surface in the shared `/timeline` activity
 * feed (actor + timestamp already resolved via the admin_users join) while
 * these two dedicated routes give the lead-detail UI a focused notes view.
 *
 * INTERNAL-ONLY: admin-gated, never referenced by any public serializer or
 * customer-facing route. Deliberately OUT of the OpenAPI spec — sibling
 * resource, same convention as /timeline and /events.
 */
router.get("/admin/leads/:id/notes", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  const [lead] = await db
    .select({ id: prelaunchLeadsTable.id })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  // Left join so notes authored via legacy x-admin-token (actorUserId
  // NULL) still surface, just without an attributed author.
  const rows = await db
    .select({
      id: leadAuditTable.id,
      after: leadAuditTable.after,
      createdAt: leadAuditTable.createdAt,
      actorEmail: adminUsersTable.email,
    })
    .from(leadAuditTable)
    .leftJoin(adminUsersTable, eq(adminUsersTable.id, leadAuditTable.actorUserId))
    .where(
      and(
        eq(leadAuditTable.leadId, id),
        eq(leadAuditTable.action, "lead_note_added"),
      ),
    )
    .orderBy(desc(leadAuditTable.createdAt));

  return res.json({
    leadId: lead.id,
    notes: rows.map((r) => ({
      id: r.id,
      note: String((r.after as { note?: unknown } | null)?.note ?? ""),
      createdAt: r.createdAt.toISOString(),
      actorEmail: r.actorEmail ?? null,
    })),
  });
});

router.post("/admin/leads/:id/notes", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  const raw = (req.body as { note?: unknown } | undefined)?.note;
  const note = typeof raw === "string" ? raw.trim() : "";
  if (note.length === 0) {
    return res.status(400).json({ error: "Note text is required" });
  }
  if (note.length > 5000) {
    return res.status(400).json({ error: "Note exceeds 5000 characters" });
  }

  const [lead] = await db
    .select({ id: prelaunchLeadsTable.id })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  // A note is deliberate user-intent data, so — unlike the fire-and-forget
  // `writeAudit` used for incidental forensics — the insert is awaited and
  // any failure is surfaced (500) rather than swallowed.
  try {
    const [inserted] = await db
      .insert(leadAuditTable)
      .values({
        action: "lead_note_added",
        leadId: id,
        actorUserId: req.adminUser?.id ?? null,
        actorTokenHash: actorTokenHash(req),
        after: { note } as never,
      })
      .returning({
        id: leadAuditTable.id,
        createdAt: leadAuditTable.createdAt,
      });

    return res.status(201).json({
      id: inserted.id,
      note,
      createdAt: inserted.createdAt.toISOString(),
      actorEmail: req.adminUser?.email ?? null,
    });
  } catch (err) {
    req.log.error({ err, leadId: id }, "Failed to persist lead note");
    return res.status(500).json({ error: "Failed to save note" });
  }
});

/**
 * POST /api/admin/leads/:id/follow-up/complete
 *
 * Phase 11D — mark the currently-scheduled follow-up as done. This is distinct
 * from clearing the follow-up via PATCH (which is "removed"): completing also
 * stamps `lastContactedAt = now()` because a completed follow-up implies the
 * operator actually made contact, and emits the `lead_followup_completed` audit
 * verb so the timeline distinguishes "I did it" from "I cancelled it".
 *
 * Idempotency / preconditions: returns 400 if no follow-up is currently
 * scheduled (nothing to complete). The clear + lastContactedAt stamp happen in
 * a single atomic UPDATE guarded on `next_follow_up_at IS NOT NULL` so two
 * concurrent completes can't both "win" and double-write the audit row.
 * NOT in OpenAPI (sibling-route convention, matches /notes and /archive).
 */
router.post("/admin/leads/:id/follow-up/complete", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  const [before] = await db
    .select({
      id: prelaunchLeadsTable.id,
      nextFollowUpAt: prelaunchLeadsTable.nextFollowUpAt,
      followUpNote: prelaunchLeadsTable.followUpNote,
      assignedTo: prelaunchLeadsTable.assignedTo,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!before) return res.status(404).json({ error: "Lead not found" });
  if (!before.nextFollowUpAt) {
    return res
      .status(400)
      .json({ error: "No follow-up is scheduled for this lead" });
  }

  const [updated] = await db
    .update(prelaunchLeadsTable)
    .set({
      nextFollowUpAt: null,
      followUpNote: null,
      lastContactedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(prelaunchLeadsTable.id, id),
        isNotNull(prelaunchLeadsTable.nextFollowUpAt),
      ),
    )
    .returning();
  // Lost the race to a concurrent complete/remove — the follow-up is already
  // gone, so there's nothing (more) to do. Treat as a benign no-op success.
  if (!updated) {
    return res
      .status(400)
      .json({ error: "No follow-up is scheduled for this lead" });
  }

  void writeAudit({
    req,
    action: "lead_followup_completed",
    leadId: updated.id,
    before: {
      dueAt: before.nextFollowUpAt.toISOString(),
      note: before.followUpNote ?? null,
      ownerId: before.assignedTo ?? null,
    },
    after: { dueAt: null, note: null, ownerId: updated.assignedTo ?? null },
  });

  return res.json(serializeLead(updated));
});

/**
 * POST /api/admin/leads/:id/convert
 *
 * Milestone 4 Phase 12B — the authorised-staff "Convert to EMA Application"
 * action, built on the Phase 12A conversion mapper. Unlike the funnel PATCH
 * (which gates conversion on the `ready_for_case` predecessor status), THIS
 * action is gated SOLELY by the mapper's readiness check:
 *   - if the mapper reports `canConvert=false`, it converts NOTHING and returns
 *     422 with the full preview (ready / missing / manual fields + workflow
 *     candidate) so the operator can see exactly why it is blocked;
 *   - if `canConvert=true`, it flips the lead to `converted` and creates the
 *     EMA application via the EXISTING integration point (`ensureCaseForLead`
 *     → `lead_cases`) — reusing the mapper's output, never re-deriving it.
 *
 * Duplicate-conversion prevention rides on the pre-existing UNIQUE(lead_id) on
 * `lead_cases`: a lead already linked to a case short-circuits to
 * `{ alreadyConverted: true, case }` with no side effect and no re-audit, so
 * the UI can disable the button and show the reference.
 *
 * Assignment / notes / prior audit are preserved — the flip only touches
 * `lead_status` + `updated_at`. Audit verbs: `lead_conversion_started`
 * (attempt begins), `lead_conversion_blocked` (mapper said no), `lead_converted`
 * (success, carries leadId + caseId/applicationId + workflow + actor),
 * `lead_conversion_failed` (unexpected error). NOT in OpenAPI — sibling-route
 * convention (matches /notes, /archive, /follow-up/complete).
 */
router.post("/admin/leads/:id/convert", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  // Load the full lead row — the mapper needs the complete PrelaunchLead.
  const [lead] = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  // Duplicate-conversion guard. A lead already linked to a case is terminal:
  // return the existing case reference with NO side effect / re-audit.
  const [existingCase] = await db
    .select()
    .from(leadCasesQueryRef)
    .where(eq(leadCasesQueryRef.leadId, id))
    .limit(1);
  if (existingCase) {
    return res.json({
      alreadyConverted: true,
      converted: false,
      case: {
        id: existingCase.id,
        referenceNumber: existingCase.referenceNumber,
        status: existingCase.status,
      },
      lead: serializeLead(
        lead,
        existingCase.id,
        {
          key: existingCase.workflowKey,
          status: existingCase.workflowStatus,
        },
        existingCase.portalStatus,
      ),
    });
  }

  // Single source of truth: the Phase 12A mapper decides both readiness AND the
  // application payload. No duplicate conversion logic lives here.
  const preview = buildConversionPreview(lead);
  const workflowKey = preview.workflowCandidate.key;

  // Blocked — one or more required fields are missing. Convert nothing; hand the
  // operator the full preview so they can see the gaps and the workflow guess.
  if (!preview.readiness.canConvert) {
    void writeAudit({
      req,
      action: "lead_conversion_blocked",
      leadId: id,
      before: { leadStatus: lead.leadStatus, caseId: null },
      after: {
        canConvert: false,
        requiredMissing: preview.readiness.requiredMissing,
        manualCompletion: preview.readiness.manualCompletion,
        workflowCandidate: workflowKey,
      },
    });
    return res.status(422).json({
      error: "Lead is not ready to convert — required fields are missing.",
      preview,
    });
  }

  // Ready — record the attempt, then perform the flip + case creation. Any
  // unexpected failure past this point audits `lead_conversion_failed`.
  void writeAudit({
    req,
    action: "lead_conversion_started",
    leadId: id,
    before: { leadStatus: lead.leadStatus, caseId: null },
    after: { workflowCandidate: workflowKey },
  });

  try {
    // Atomic flip guarded on NOT-already-converted so a concurrent convert
    // can't double-run. The mapper (not the `ready_for_case` predecessor) is
    // the gate, so there is no status precondition beyond "not converted yet".
    const [updated] = await db
      .update(prelaunchLeadsTable)
      .set({ leadStatus: "converted", updatedAt: new Date() })
      .where(
        and(
          eq(prelaunchLeadsTable.id, id),
          ne(prelaunchLeadsTable.leadStatus, "converted"),
        ),
      )
      .returning();

    // Lost the race — a concurrent convert flipped it between our case check
    // and this UPDATE. `ensureCaseForLead` is idempotent, so fall through and
    // resolve the existing case rather than erroring.
    const effectiveLead = updated ?? lead;

    const result = await ensureCaseForLead(
      effectiveLead.id,
      effectiveLead.referenceNumber,
    );
    const caseId = result.row.id;

    // Only audit the terminal success when THIS call created the case — the
    // `created` flag is sourced from the atomic INSERT … ON CONFLICT RETURNING,
    // so at most one of N racing callers logs `lead_converted`.
    if (result.created) {
      void writeAudit({
        req,
        action: "lead_converted",
        leadId: id,
        caseId,
        before: { leadStatus: lead.leadStatus, caseId: null },
        after: {
          leadStatus: "converted",
          caseId,
          applicationId: caseId,
          workflowCandidate: workflowKey,
        },
      });
    }

    // Phase 12C — attach the resolved workflow (or flag for manual review).
    // Idempotent: only transitions a case out of 'unassigned', so a re-run or a
    // race never double-attaches. Audit ONLY when this call actually changed the
    // state, mirroring the `created` discipline above.
    const workflow = await assignWorkflowForCase(
      caseId,
      preview.workflowCandidate,
    );
    if (workflow.changed) {
      void writeAudit({
        req,
        action:
          workflow.outcome === "assigned"
            ? "case_workflow_assigned"
            : "case_workflow_review_required",
        leadId: id,
        caseId,
        before: { workflowStatus: "unassigned", workflowKey: null },
        after: {
          workflowStatus: workflow.outcome,
          workflowKey: workflow.workflowKey,
          workflowLabel: workflow.workflowLabel,
          reason: workflow.reason,
        },
      });
    }

    // Return the freshest lead so assignment / notes / status all reflect the
    // post-conversion row, plus the linked case reference + workflow state.
    const [freshLead] = await db
      .select()
      .from(prelaunchLeadsTable)
      .where(eq(prelaunchLeadsTable.id, id))
      .limit(1);

    return res.json({
      converted: result.created,
      alreadyConverted: !result.created,
      case: {
        id: result.row.id,
        referenceNumber: result.row.referenceNumber,
        status: result.row.status,
        workflowKey: workflow.workflowKey,
        workflowStatus: workflow.outcome,
      },
      lead: serializeLead(
        freshLead ?? effectiveLead,
        caseId,
        {
          key: workflow.workflowKey,
          status: workflow.outcome,
        },
        result.row.portalStatus,
      ),
    });
  } catch (err) {
    req.log.error({ err, leadId: id }, "Lead conversion failed");
    void writeAudit({
      req,
      action: "lead_conversion_failed",
      leadId: id,
      before: { leadStatus: lead.leadStatus, caseId: null },
      after: {
        workflowCandidate: workflowKey,
        error: err instanceof Error ? err.message : "unknown",
      },
    });
    return res.status(500).json({ error: "Conversion failed" });
  }
});

/**
 * POST /api/admin/leads/:id/prepare-portal
 *
 * Milestone 4 Phase 13B — admin-only "Prepare Client Portal" action. Marks a
 * converted, workflow-assigned case as `ready_to_activate` for a FUTURE
 * client-portal activation. PREPARATION ONLY: no client credentials, no email,
 * no WhatsApp, nothing exposed publicly — it flips a single status column.
 *
 * Sibling route (NOT in OpenAPI — matches /notes, /archive, /convert,
 * /follow-up/complete).
 *
 * Preconditions (all enforced server-side; the UI mirrors them):
 *   - lead exists (404) and is converted (a linked case exists) — else 422.
 *   - the case's workflow is `assigned` — else BLOCK (422), leave portal_status
 *     untouched, audit `portal_activation_blocked`.
 *
 * Idempotency / no-downgrade (handled atomically in prepareCasePortal):
 *   - already `ready_to_activate` ⇒ 200 success, NO duplicate audit.
 *   - already `activated` ⇒ 200 success, never downgraded, NO audit.
 *   - transition ⇒ 200, audit `portal_prepared` exactly once (guarded on the
 *     atomic row transition, so concurrent callers audit at most once).
 */
router.post("/admin/leads/:id/prepare-portal", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  const [lead] = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  // Must be converted with a linked case — portal prep only applies to cases.
  const [existingCase] = await db
    .select()
    .from(leadCasesQueryRef)
    .where(eq(leadCasesQueryRef.leadId, id))
    .limit(1);
  if (!existingCase) {
    return res.status(422).json({
      error: "Lead is not converted — no case to prepare.",
    });
  }

  try {
    const result = await prepareCasePortal(existingCase.id);

    // Workflow undecided — block, leave portal_status untouched, audit the block.
    if (result.outcome === "blocked_review") {
      void writeAudit({
        req,
        action: "portal_activation_blocked",
        leadId: id,
        caseId: existingCase.id,
        before: { portalStatus: result.portalStatus },
        after: {
          portalStatus: result.portalStatus,
          workflowStatus: result.workflowStatus,
          reason: "workflow_not_assigned",
        },
      });
      return res.status(422).json({
        error:
          "Case workflow requires review before the portal can be prepared.",
        outcome: result.outcome,
        lead: serializeLead(
          lead,
          existingCase.id,
          {
            key: existingCase.workflowKey,
            status: result.workflowStatus,
          },
          result.portalStatus,
        ),
      });
    }

    // Audit ONLY the single call that actually transitioned the row — re-runs
    // and already-activated cases are silent no-ops (no duplicate history).
    if (result.changed) {
      void writeAudit({
        req,
        action: "portal_prepared",
        leadId: id,
        caseId: existingCase.id,
        before: { portalStatus: result.previousPortalStatus },
        after: {
          portalStatus: result.portalStatus,
          workflowStatus: result.workflowStatus,
        },
      });
    }

    return res.json({
      prepared: result.changed,
      outcome: result.outcome,
      lead: serializeLead(
        lead,
        existingCase.id,
        {
          key: existingCase.workflowKey,
          status: result.workflowStatus,
        },
        result.portalStatus,
      ),
    });
  } catch (err) {
    req.log.error({ err, leadId: id }, "Portal preparation failed");
    void writeAudit({
      req,
      action: "portal_activation_failed",
      leadId: id,
      caseId: existingCase.id,
      before: { portalStatus: existingCase.portalStatus },
      after: {
        portalStatus: existingCase.portalStatus,
        error: err instanceof Error ? err.message : "unknown",
      },
    });
    return res.status(500).json({ error: "Portal preparation failed" });
  }
});

/**
 * Phase 13C — POST /api/admin/leads/:id/activate-portal
 *
 * Admin-only ACTIVATION of a PREPARED case's client portal (sibling of
 * /prepare-portal, /convert, /notes — NOT in OpenAPI). Transitions a case whose
 * portal is `ready_to_activate` → `activated`. STILL no client-facing side
 * effects — no credentials, no email/WhatsApp, nothing exposed publicly.
 *
 * Flow (gate handled atomically in activateCasePortal):
 *   - lead missing ⇒ 404.
 *   - no linked case (not converted) ⇒ 422.
 *   - workflow not `assigned` ⇒ 422, audit `portal_activation_blocked`
 *     (reason workflow_not_assigned), portal untouched.
 *   - portal not `ready_to_activate` ⇒ 422, audit `portal_activation_blocked`
 *     (reason portal_not_ready), portal untouched.
 *   - already `activated` ⇒ 200 success, never downgraded, NO audit.
 *   - transition ⇒ 200, audit `portal_activated` exactly once (guarded on the
 *     atomic row transition, so concurrent callers audit at most once).
 */
router.post("/admin/leads/:id/activate-portal", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  const [lead] = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  // Must be converted with a linked case — activation only applies to cases.
  const [existingCase] = await db
    .select()
    .from(leadCasesQueryRef)
    .where(eq(leadCasesQueryRef.leadId, id))
    .limit(1);
  if (!existingCase) {
    return res.status(422).json({
      error: "Lead is not converted — no case to activate.",
    });
  }

  try {
    const result = await activateCasePortal(existingCase.id);

    // Blocked — workflow undecided OR portal not prepared. Leave state
    // untouched and audit the block with the specific reason.
    if (
      result.outcome === "blocked_review" ||
      result.outcome === "blocked_not_ready"
    ) {
      const reason =
        result.outcome === "blocked_review"
          ? "workflow_not_assigned"
          : "portal_not_ready";
      void writeAudit({
        req,
        action: "portal_activation_blocked",
        leadId: id,
        caseId: existingCase.id,
        before: { portalStatus: result.portalStatus },
        after: {
          portalStatus: result.portalStatus,
          workflowStatus: result.workflowStatus,
          reason,
        },
      });
      return res.status(422).json({
        error:
          result.outcome === "blocked_review"
            ? "Case workflow requires review before the portal can be activated."
            : "The portal must be prepared before it can be activated.",
        outcome: result.outcome,
        lead: serializeLead(
          lead,
          existingCase.id,
          {
            key: existingCase.workflowKey,
            status: result.workflowStatus,
          },
          result.portalStatus,
        ),
      });
    }

    // Audit ONLY the single call that actually transitioned the row — re-runs
    // and already-activated cases are silent no-ops (no duplicate history).
    if (result.changed) {
      void writeAudit({
        req,
        action: "portal_activated",
        leadId: id,
        caseId: existingCase.id,
        before: { portalStatus: result.previousPortalStatus },
        after: {
          portalStatus: result.portalStatus,
          workflowStatus: result.workflowStatus,
        },
      });
    }

    return res.json({
      activated: result.changed,
      outcome: result.outcome,
      lead: serializeLead(
        lead,
        existingCase.id,
        {
          key: existingCase.workflowKey,
          status: result.workflowStatus,
        },
        result.portalStatus,
      ),
    });
  } catch (err) {
    req.log.error({ err, leadId: id }, "Portal activation failed");
    void writeAudit({
      req,
      action: "portal_activation_failed",
      leadId: id,
      caseId: existingCase.id,
      before: { portalStatus: existingCase.portalStatus },
      after: {
        portalStatus: existingCase.portalStatus,
        error: err instanceof Error ? err.message : "unknown",
      },
    });
    return res.status(500).json({ error: "Portal activation failed" });
  }
});

export default router;
