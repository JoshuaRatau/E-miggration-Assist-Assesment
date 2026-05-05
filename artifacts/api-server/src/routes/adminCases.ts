import { Router, type IRouter } from "express";
import { db, prelaunchLeadsTable, leadCasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdminToken } from "../lib/adminAuth";
import { deriveNextStep } from "../lib/classification";

const router: IRouter = Router();

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

export default router;
