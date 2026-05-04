import { Router, type IRouter } from "express";
import { db, prelaunchLeadsTable } from "@workspace/db";
import { CreateLeadBody, ListLeadsQueryParams } from "@workspace/api-zod";
import { desc, eq } from "drizzle-orm";
import { classifyLead, generateReferenceNumber } from "../lib/scoring";

const router: IRouter = Router();

function serializeLead(row: typeof prelaunchLeadsTable.$inferSelect) {
  return {
    ...row,
    visaExpiryDate: row.visaExpiryDate ?? null,
    exitDate: row.exitDate ?? null,
    consentTimestamp: row.consentTimestamp
      ? row.consentTimestamp.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.post("/leads", async (req, res) => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
  }
  const data = parsed.data;

  if (!data.consentAccepted) {
    return res.status(400).json({ error: "Consent is required" });
  }

  const scoring = classifyLead({
    immigrationSituation: data.immigrationSituation ?? null,
    passportStatus: data.passportStatus ?? null,
    hasSupportingDocuments: data.hasSupportingDocuments ?? null,
    previousOverstay: data.previousOverstay ?? null,
    currentlyInSouthAfrica: data.currentlyInSouthAfrica ?? null,
    visaExpiryDate: data.visaExpiryDate ?? null,
  });

  const referenceNumber = generateReferenceNumber();
  const now = new Date();

  const [inserted] = await db
    .insert(prelaunchLeadsTable)
    .values({
      referenceNumber,
      fullName: data.fullName,
      email: data.email,
      whatsapp: data.whatsapp ?? null,
      nationality: data.nationality,
      countryOfResidence: data.countryOfResidence ?? null,
      currentlyInSouthAfrica: data.currentlyInSouthAfrica ?? null,
      passportStatus: data.passportStatus ?? null,
      visaHistory: data.visaHistory ?? null,
      immigrationSituation: data.immigrationSituation,
      visaExpiryDate: data.visaExpiryDate ?? null,
      exitDate: data.exitDate ?? null,
      borderDocumentIssued: data.borderDocumentIssued ?? null,
      overstayReason: data.overstayReason ?? null,
      hasSupportingDocuments: data.hasSupportingDocuments ?? null,
      previousOverstay: data.previousOverstay ?? null,
      preferredContactMethod: data.preferredContactMethod ?? null,
      consentAccepted: data.consentAccepted,
      consentTimestamp: now,
      leadScore: scoring.leadScore,
      leadCategory: scoring.leadCategory,
      internalClassification: scoring.internalClassification,
    })
    .returning();

  if (!inserted) {
    return res.status(500).json({ error: "Failed to create lead" });
  }

  return res.status(201).json(serializeLead(inserted));
});

router.get("/leads", async (req, res) => {
  const parsed = ListLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
  }
  const limit = parsed.data.limit ?? 20;

  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .orderBy(desc(prelaunchLeadsTable.createdAt))
    .limit(limit);

  return res.json(rows.map(serializeLead));
});

router.get("/leads/:referenceNumber", async (req, res) => {
  const { referenceNumber } = req.params;
  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.referenceNumber, referenceNumber))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return res.status(404).json({ error: "Lead not found" });
  }

  return res.json(serializeLead(rows[0]));
});

export default router;
