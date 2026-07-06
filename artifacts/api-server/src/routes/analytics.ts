import { Router, type IRouter } from "express";
import { db, analyticsEventsTable, prelaunchLeadsTable } from "@workspace/db";
import { TrackAnalyticsEventBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const ALLOWED_EVENTS = new Set([
  "assessment_started",
  "assessment_completed",
  "classification_result",
  "document_upload",
  // Conversion Engine V1: fired when an admin clicks the per-row "Contact"
  // button on /admin.  Payload carries { leadId, channel: "whatsapp"|"email" }.
  "lead_contact_clicked",
  // Milestone 2 — Funnel Intelligence (Phase 9): lightweight funnel analytics.
  // Metadata (route/theme/CTA label/destination/timestamp) rides in `payload`.
  "funnel_route_selected",
  "funnel_assessment_started",
  "funnel_lead_submitted",
  "reference_lookup_started",
]);

router.post("/analytics/events", async (req, res) => {
  const parsed = TrackAnalyticsEventBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const data = parsed.data;

  if (!ALLOWED_EVENTS.has(data.eventName)) {
    return res.status(400).json({
      error: `eventName must be one of: ${[...ALLOWED_EVENTS].join(", ")}`,
    });
  }

  let leadId: string | null = null;
  if (data.referenceNumber) {
    const rows = await db
      .select({ id: prelaunchLeadsTable.id })
      .from(prelaunchLeadsTable)
      .where(eq(prelaunchLeadsTable.referenceNumber, data.referenceNumber))
      .limit(1);
    leadId = rows[0]?.id ?? null;
  }

  const [inserted] = await db
    .insert(analyticsEventsTable)
    .values({
      eventName: data.eventName,
      referenceNumber: data.referenceNumber ?? null,
      leadId,
      payload: (data.payload as Record<string, unknown> | undefined) ?? null,
    })
    .returning();

  if (!inserted) {
    return res.status(500).json({ error: "Failed to record event" });
  }

  return res.status(201).json({
    id: inserted.id,
    eventName: inserted.eventName,
    createdAt: inserted.createdAt.toISOString(),
  });
});

export default router;
