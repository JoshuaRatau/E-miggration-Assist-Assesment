import { Router, type IRouter } from "express";
import { db, prelaunchLeadsTable, leadCasesTable } from "@workspace/db";
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
import { requireAdminToken } from "../lib/adminAuth";
import { deriveNextStep } from "../lib/classification";
import { CASE_STATUS_VALUES } from "../lib/caseStatus";

const router: IRouter = Router();

function serializeCase(row: typeof leadCasesTable.$inferSelect) {
  return {
    id: row.id,
    leadId: row.leadId,
    referenceNumber: row.referenceNumber,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * GET /api/admin/cases/:caseId
 *
 * Admin-only.  Returns the case row plus a snapshot of the originating
 * lead so the case-detail page can render reference, status, notes and
 * the funnel next-step in a single round-trip.
 *
 * Auth: x-admin-token header is required (mirrors the rest of the admin
 * surface — fails closed with 503 when ADMIN_EMAIL_TOKEN is unset, 401
 * when the header is missing/wrong).
 *
 * NO PUBLIC EXPOSURE: this endpoint is intentionally NOT modelled in
 * openapi.yaml, mirroring the PATCH /admin/leads/{id} convention — the
 * generated client cannot inject `x-admin-token`, so the frontend uses
 * raw `fetch` (see admin-case-detail.tsx).
 */
router.get("/admin/cases/:caseId", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const { caseId } = req.params;

  // Single round-trip via INNER JOIN — every case has a lead by virtue
  // of the not-null `lead_id` column, so an inner join is correct here
  // and lets us drop the dual-query pattern.
  const [row] = await db
    .select({
      caseRow: leadCasesTable,
      lead: prelaunchLeadsTable,
    })
    .from(leadCasesTable)
    .innerJoin(
      prelaunchLeadsTable,
      eq(prelaunchLeadsTable.id, leadCasesTable.leadId),
    )
    .where(eq(leadCasesTable.id, caseId))
    .limit(1);

  if (!row) {
    return res.status(404).json({ error: "Case not found" });
  }

  return res.json({
    id: row.caseRow.id,
    leadId: row.caseRow.leadId,
    referenceNumber: row.caseRow.referenceNumber,
    status: row.caseRow.status,
    createdAt: row.caseRow.createdAt.toISOString(),
    updatedAt: row.caseRow.updatedAt.toISOString(),
    // Funnel hint derived from the LEAD's status — the case-detail page
    // surfaces "what to do next" using the same map as the dashboard.
    nextStep: deriveNextStep(row.lead.leadStatus),
    // Embedded lead snapshot.  Only the fields the case-detail page
    // actually renders are exposed — internal classification/score are
    // intentionally omitted (per the rules-engine privacy stance).
    lead: {
      id: row.lead.id,
      referenceNumber: row.lead.referenceNumber,
      fullName: row.lead.fullName,
      email: row.lead.email,
      whatsapp: row.lead.whatsapp,
      nationality: row.lead.nationality,
      countryOfResidence: row.lead.countryOfResidence,
      immigrationSituation: row.lead.immigrationSituation,
      leadStatus: row.lead.leadStatus,
      leadPriority: row.lead.leadPriority,
      adminNotes: row.lead.adminNotes,
      createdAt: row.lead.createdAt.toISOString(),
      updatedAt: row.lead.updatedAt.toISOString(),
    },
  });
});

/**
 * PATCH /api/admin/cases/:caseId
 *
 * Admin-only.  Advances the case lifecycle.  Body: { status: <enum> }.
 *
 * Forward-only guard mirrors the lead funnel in adminLeads.ts: the
 * allowed-predecessor set is encoded ATOMICALLY in the UPDATE WHERE
 * predicate so two concurrent operators cannot race past each other.
 * Same-status writes are no-ops (safe for optimistic-UI retries).
 *
 * Responses:
 *   200 — updated case row (serializeCase shape)
 *   400 — missing/invalid status
 *   404 — case not found
 *   409 — regression blocked (body explains the order)
 *
 * NOT modelled in openapi.yaml — same x-admin-token convention as the
 * other admin mutation endpoints; the frontend uses raw fetch.
 */
router.patch("/admin/cases/:caseId", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const { caseId } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(body, "status")) {
    return res.status(400).json({ error: "Body must include `status`." });
  }
  const requestedStatus = body.status;
  if (
    typeof requestedStatus !== "string" ||
    !CASE_STATUS_VALUES.includes(requestedStatus as never)
  ) {
    return res.status(400).json({
      error: `status must be one of: ${CASE_STATUS_VALUES.join(", ")}`,
    });
  }

  // Forward-only guard, atomically encoded in WHERE.  Allowed
  // predecessors = all canonical statuses up to AND INCLUDING the
  // requested one (so same-status writes succeed as no-ops).  Legacy
  // values not in the enum are also allowed through, matching the
  // permissive stance of `canAdvanceCaseStatus` and avoiding lock-out
  // on rows that predate a future schema change.
  const requestedIdx = CASE_STATUS_VALUES.indexOf(
    requestedStatus as (typeof CASE_STATUS_VALUES)[number],
  );
  const allowedPredecessors = CASE_STATUS_VALUES.slice(0, requestedIdx + 1);
  const allKnown = [...CASE_STATUS_VALUES];

  const [updated] = await db
    .update(leadCasesTable)
    .set({ status: requestedStatus, updatedAt: new Date() })
    .where(
      and(
        eq(leadCasesTable.id, caseId),
        or(
          inArray(leadCasesTable.status, allowedPredecessors),
          notInArray(leadCasesTable.status, allKnown),
        )!,
      ),
    )
    .returning();

  if (!updated) {
    // Disambiguate 404 vs 409 with a follow-up read.  Racy w.r.t. a
    // concurrent delete (which would surface as 409 instead of 404),
    // but that's a benign misclassification, not a correctness issue.
    const [existing] = await db
      .select({ status: leadCasesTable.status })
      .from(leadCasesTable)
      .where(eq(leadCasesTable.id, caseId))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Case not found" });
    }
    return res.status(409).json({
      error:
        `Case lifecycle regression blocked: cannot move case from ` +
        `"${existing.status}" back to "${requestedStatus}". ` +
        `Status may only move forward in the order: ` +
        `${CASE_STATUS_VALUES.join(" → ")}.`,
    });
  }

  return res.json(serializeCase(updated));
});

export default router;
