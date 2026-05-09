import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  analyticsEventsTable,
  leadCasesTable as leadCasesQueryRef,
  leadEventsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
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
    // Phase 6B — surface the score-recompute worker's metadata. The Date
    // column is normalised to an ISO-8601 string so it crosses the wire
    // identically to every other timestamp on the Lead payload.
    leadScoreComputedAt: row.leadScoreComputedAt
      ? row.leadScoreComputedAt.toISOString()
      : null,
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

  if (fieldsUpdated.length === 0) {
    return res.status(400).json({
      error:
        "Body must include at least one of: status, priority, notes, intendedTier",
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
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

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

export default router;
