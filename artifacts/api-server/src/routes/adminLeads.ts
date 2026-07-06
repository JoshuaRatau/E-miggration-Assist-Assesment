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
import { writeAudit, actorTokenHash } from "../lib/audit";
import { recordLeadEvent } from "../lib/recordLeadEvent";
import { canAdvanceStatus } from "../lib/classification";

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
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
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

export default router;
