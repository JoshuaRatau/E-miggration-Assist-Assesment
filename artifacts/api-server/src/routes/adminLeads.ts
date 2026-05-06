import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  analyticsEventsTable,
  leadCasesTable as leadCasesQueryRef,
} from "@workspace/db";
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
import {
  LEAD_STATUS_VALUES,
  LEAD_PRIORITY_VALUES,
  deriveNextStep,
} from "../lib/classification";
import { requireAdminToken } from "../lib/adminAuth";
import { ensureCaseForLead } from "../lib/cases";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

function serializeLead(
  row: typeof prelaunchLeadsTable.$inferSelect,
  caseId: string | null = null,
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
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
    // Conversion-funnel hint mirrored from leads.ts so PATCH responses stay
    // consistent with GET — see deriveNextStep().
    nextStep: deriveNextStep(row.leadStatus),
    // Lightweight case linkage.  Populated by the lead→case conversion
    // (see ensureCaseForLead) and on read by a LEFT JOIN with lead_cases.
    // null for leads that have not reached `converted` yet.
    caseId,
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

  if (fieldsUpdated.length === 0) {
    return res.status(400).json({
      error: "Body must include at least one of: status, priority, notes",
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
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

  // Funnel-regression guard — enforced ATOMICALLY in the UPDATE's WHERE
  // clause to close the TOCTOU race where two concurrent operators could
  // each pass a separate read-then-update check and the second write
  // could regress what the first set.  We restrict the predicate to:
  //   leadStatus IN <allowed predecessors>  OR  leadStatus is legacy
  // The legacy branch (status not in the canonical enum) preserves the
  // permissive behavior of `canAdvanceStatus`: legacy DB values are
  // never locked out by the funnel.  When status isn't in the patch,
  // no extra predicate is added so priority/notes-only updates skip the
  // check entirely.
  //
  // Pre-traffic hardening: the `converted` terminal status is GATED to
  // a single allowed predecessor — `ready_for_case`. Operators must
  // walk the lead all the way through the funnel before flipping the
  // conversion bit; any earlier state → converted is a 409. Same-status
  // converted → converted is still a no-op so notes/priority edits on
  // an already-converted lead keep working.
  const whereParts = [eq(prelaunchLeadsTable.id, id)];
  if (requestedStatus !== null) {
    if (requestedStatus === "converted") {
      // Strict converted-predecessor lock. NO legacy escape hatch here:
      // a lead carrying an unknown/legacy status MUST first be moved
      // forward to `ready_for_case` (which the legacy-status branch
      // below DOES allow) before it can be converted. Without this
      // restriction an unknown status would slip past the lock.
      whereParts.push(
        inArray(prelaunchLeadsTable.leadStatus, [
          "ready_for_case",
          "converted",
        ]),
      );
    } else {
      const requestedIdx = LEAD_STATUS_VALUES.indexOf(
        requestedStatus as (typeof LEAD_STATUS_VALUES)[number],
      );
      const allowedPredecessors = LEAD_STATUS_VALUES.slice(
        0,
        requestedIdx + 1,
      );
      const allKnown = [...LEAD_STATUS_VALUES];
      whereParts.push(
        or(
          inArray(
            prelaunchLeadsTable.leadStatus,
            allowedPredecessors as string[],
          ),
          notInArray(prelaunchLeadsTable.leadStatus, allKnown),
        )!,
      );
    }
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
          `Funnel regression blocked: cannot move lead from ` +
          `"${existing.leadStatus}" back to "${requestedStatus}". ` +
          `Status may only move forward in the funnel order: ` +
          `${LEAD_STATUS_VALUES.join(" → ")}.`,
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

  return res.json(serializeLead(updated, caseId));
});

export default router;
