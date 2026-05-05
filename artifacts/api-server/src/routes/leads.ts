import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  analyticsEventsTable,
  leadEngagementsTable,
} from "@workspace/db";
import { CreateLeadBody, ListLeadsQueryParams } from "@workspace/api-zod";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import {
  classifyCase,
  deriveAutoPriority,
  deriveNextStep,
  generateReferenceNumber,
} from "../lib/classification";
import { composeConfirmationBody, sendConfirmationEmail } from "../lib/email";
import { sendMessage } from "../lib/messaging";
import { normalizeWhatsapp } from "../lib/whatsapp";
import { requireAdminToken } from "../lib/adminAuth";

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
    updatedAt: row.updatedAt.toISOString(),
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
    nextStep: deriveNextStep(row.leadStatus),
  };
}

// Admin LIST serializer.  Exposes ONLY the dashboard's spec'd fields plus
// `referenceNumber` (used for row testids and cross-reference in the UI).
// Crucially, it omits internal "rules engine" fields — `internalClassification`,
// `leadScore`, `leadCategory`, `adminNotes` — and bulky funnel data the
// dashboard does not need.  Per spec: "Do NOT expose rules engine data yet."
function serializeLeadAdminList(row: typeof prelaunchLeadsTable.$inferSelect) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    fullName: row.fullName,
    email: row.email,
    whatsapp: row.whatsapp,
    immigrationSituation: row.immigrationSituation,
    leadStatus: row.leadStatus,
    leadPriority: row.leadPriority,
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
    createdAt: row.createdAt.toISOString(),
    // Conversion-funnel hint derived from leadStatus.  See `deriveNextStep`.
    nextStep: deriveNextStep(row.leadStatus),
  };
}

// Public-safe view of a lead for the user-facing reference lookup. Strips out
// every internal CRM field (score, priority, internalClassification,
// leadStatus, adminNotes) and contact PII that the lookup page does not need
// to render.
function serializeLeadPublic(row: typeof prelaunchLeadsTable.$inferSelect) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    fullName: row.fullName,
    nationality: row.nationality,
    immigrationSituation: row.immigrationSituation,
    leadCategory: row.leadCategory,
    consentAccepted: row.consentAccepted,
    consentTimestamp: row.consentTimestamp
      ? row.consentTimestamp.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const toDateString = (d: Date | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toISOString().slice(0, 10)
    : null;

router.post("/leads", async (req, res) => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const data = parsed.data;

  if (!data.consentAccepted) {
    return res.status(400).json({ error: "Consent is required" });
  }

  // Local fire-and-forget confirmation dispatcher used by BOTH the
  // new-insert branch AND the dedup-update branch.  Resubmissions are
  // first-class: a real client filling the form a second time should
  // get acknowledged, not silently ignored.
  //
  // `cooldownMinutes` (only relevant for the dedup branch) suppresses a
  // fresh send only if the SAME channel was already successfully delivered
  // to within the window — so accidental double-clicks don't spam, while
  // a legitimate retry a couple of minutes later still goes through.
  // status='sent' is the only blocker; pending/failed never block a retry.
  const dispatchConfirmation = (
    lead: typeof prelaunchLeadsTable.$inferSelect,
    cooldownMinutes: number,
  ): void => {
    if (!lead.consentAccepted) return;

    const hasWhatsApp =
      typeof lead.whatsapp === "string" && lead.whatsapp.length > 0;
    const hasEmail =
      typeof lead.email === "string" && lead.email.length > 0;
    const wantsWhatsApp = lead.preferredContactMethod === "whatsapp";

    let pickedChannel: "email" | "whatsapp" | null = null;
    let pickedRecipient: string | null = null;
    if (wantsWhatsApp && hasWhatsApp) {
      pickedChannel = "whatsapp";
      pickedRecipient = lead.whatsapp!;
    } else if (hasEmail) {
      pickedChannel = "email";
      pickedRecipient = lead.email!;
    } else if (hasWhatsApp) {
      pickedChannel = "whatsapp";
      pickedRecipient = lead.whatsapp!;
    }
    if (!pickedChannel || !pickedRecipient) return;

    const channel = pickedChannel;
    const recipient = pickedRecipient;
    const referenceNumber = lead.referenceNumber;
    const fullName = lead.fullName;
    const leadId = lead.id;

    void (async () => {
      if (cooldownMinutes > 0) {
        const cutoff = new Date(Date.now() - cooldownMinutes * 60_000);
        try {
          const recent = await db
            .select({ id: leadEngagementsTable.id })
            .from(leadEngagementsTable)
            .where(
              and(
                eq(leadEngagementsTable.leadId, leadId),
                eq(leadEngagementsTable.type, "confirmation"),
                eq(leadEngagementsTable.channel, channel),
                eq(leadEngagementsTable.status, "sent"),
                gt(leadEngagementsTable.createdAt, cutoff),
              ),
            )
            .limit(1);
          if (recent.length > 0) {
            req.log.info(
              { leadId, channel, cooldownMinutes },
              "Skipping resubmission confirmation (recent send within cooldown)",
            );
            return;
          }
        } catch (err) {
          req.log.warn(
            { err },
            "Confirmation cooldown lookup failed; sending anyway",
          );
        }
      }

      let engagementId: string | null = null;
      try {
        const [engagement] = await db
          .insert(leadEngagementsTable)
          .values({
            leadId,
            channel,
            type: "confirmation",
            status: "pending",
          })
          .returning({ id: leadEngagementsTable.id });
        engagementId = engagement?.id ?? null;
      } catch (err) {
        req.log.warn({ err }, "Failed to record confirmation engagement row");
      }

      try {
        let nextStatus: "sent" | "failed" | "pending" = "pending";
        let analyticsPayload: Record<string, unknown>;

        if (channel === "whatsapp") {
          const result = await sendMessage({
            channel: "whatsapp",
            to: recipient,
            message: composeConfirmationBody({ referenceNumber, fullName }),
            referenceNumber,
          });
          if (result.ok) nextStatus = "sent";
          else if (result.pending) nextStatus = "pending";
          else nextStatus = "failed";
          analyticsPayload = result.ok
            ? { success: true, channel, messageId: result.id }
            : { success: false, channel, reason: result.reason };
        } else {
          const sendResult = await sendConfirmationEmail({
            to: recipient,
            referenceNumber,
            fullName,
          });
          nextStatus = sendResult.ok ? "sent" : "failed";
          analyticsPayload = sendResult.ok
            ? { success: true, channel, messageId: sendResult.id }
            : { success: false, channel, reason: sendResult.reason };
        }

        if (engagementId) {
          await db
            .update(leadEngagementsTable)
            .set({ status: nextStatus })
            .where(eq(leadEngagementsTable.id, engagementId))
            .catch((err) =>
              req.log.warn(
                { err },
                "Failed to update confirmation engagement status",
              ),
            );
        }

        await db.insert(analyticsEventsTable).values({
          eventName:
            channel === "whatsapp"
              ? "whatsapp_sent_confirmation"
              : "email_sent_confirmation",
          leadId,
          referenceNumber,
          payload: analyticsPayload,
        });
      } catch (err) {
        req.log.warn({ err }, "Confirmation pipeline error (silent)");
      }
    })();
  };

  // WhatsApp: normalise to canonical +E.164. Invalid → store null. Submission
  // is NEVER blocked on a bad number. Raw user input is intentionally not
  // persisted (stored value is always either the canonical form or null).
  const normalizedWhatsapp = normalizeWhatsapp(data.whatsapp);

  const result = classifyCase({
    immigrationSituation: data.immigrationSituation ?? null,
    overstayReason: data.overstayReason ?? null,
    hasSupportingDocuments: data.hasSupportingDocuments ?? null,
  });
  // Auto-priority is computed from the visa/situation context (NOT the score),
  // so a fresh insert always has a sensible default.  Admin can override via
  // PATCH /api/admin/leads/:id.
  const priority = deriveAutoPriority(
    data.immigrationSituation ?? null,
    data.visaHistory ?? null,
  );
  const now = new Date();

  // Duplicate detection: same email OR same canonical whatsapp → update existing
  const dupConditions = [];
  if (data.email) dupConditions.push(eq(prelaunchLeadsTable.email, data.email));
  if (normalizedWhatsapp)
    dupConditions.push(eq(prelaunchLeadsTable.whatsapp, normalizedWhatsapp));

  let existing: typeof prelaunchLeadsTable.$inferSelect | undefined;
  if (dupConditions.length > 0) {
    const rows = await db
      .select()
      .from(prelaunchLeadsTable)
      .where(or(...dupConditions))
      .orderBy(desc(prelaunchLeadsTable.createdAt))
      .limit(1);
    existing = rows[0];
  }

  if (existing) {
    const [updated] = await db
      .update(prelaunchLeadsTable)
      .set({
        fullName: data.fullName,
        email: data.email,
        whatsapp: normalizedWhatsapp ?? existing.whatsapp,
        nationality: data.nationality,
        countryOfResidence: data.countryOfResidence ?? existing.countryOfResidence,
        currentlyInSouthAfrica:
          data.currentlyInSouthAfrica ?? existing.currentlyInSouthAfrica,
        passportStatus: data.passportStatus ?? existing.passportStatus,
        visaHistory: data.visaHistory ?? existing.visaHistory,
        immigrationSituation: data.immigrationSituation,
        visaExpiryDate:
          toDateString(data.visaExpiryDate) ?? existing.visaExpiryDate,
        exitDate: toDateString(data.exitDate) ?? existing.exitDate,
        borderDocumentIssued:
          data.borderDocumentIssued ?? existing.borderDocumentIssued,
        overstayReason: data.overstayReason ?? existing.overstayReason,
        hasSupportingDocuments:
          data.hasSupportingDocuments ?? existing.hasSupportingDocuments,
        previousOverstay: data.previousOverstay ?? existing.previousOverstay,
        preferredContactMethod:
          data.preferredContactMethod ?? existing.preferredContactMethod,
        consentAccepted: data.consentAccepted,
        consentTimestamp: now,
        internalClassification: result.category,
        leadScore: result.score,
        leadCategory: result.label,
        // Preserve existing leadPriority/leadStatus/adminNotes — admin may
        // have customised these on the existing record.  Auto-priority only
        // seeds NEW inserts; never overwrite operator overrides.
        updatedAt: now,
      })
      .where(eq(prelaunchLeadsTable.id, existing.id))
      .returning();

    if (!updated) {
      return res.status(500).json({ error: "Failed to update existing lead" });
    }

    req.log.info(
      { leadId: updated.id, referenceNumber: updated.referenceNumber },
      "Duplicate detected — updated existing lead",
    );

    // Resubmissions get acknowledged too. The 1-minute cooldown absorbs
    // accidental double-clicks; anything beyond that is a real retry and
    // the client deserves a fresh confirmation.
    dispatchConfirmation(updated, 1);

    return res.status(200).json(serializeLead(updated));
  }

  const referenceNumber = generateReferenceNumber();

  const [inserted] = await db
    .insert(prelaunchLeadsTable)
    .values({
      referenceNumber,
      fullName: data.fullName,
      email: data.email,
      whatsapp: normalizedWhatsapp,
      nationality: data.nationality,
      countryOfResidence: data.countryOfResidence ?? null,
      currentlyInSouthAfrica: data.currentlyInSouthAfrica ?? null,
      passportStatus: data.passportStatus ?? null,
      visaHistory: data.visaHistory ?? null,
      immigrationSituation: data.immigrationSituation,
      visaExpiryDate: toDateString(data.visaExpiryDate),
      exitDate: toDateString(data.exitDate),
      borderDocumentIssued: data.borderDocumentIssued ?? null,
      overstayReason: data.overstayReason ?? null,
      hasSupportingDocuments: data.hasSupportingDocuments ?? null,
      previousOverstay: data.previousOverstay ?? null,
      preferredContactMethod: data.preferredContactMethod ?? null,
      consentAccepted: data.consentAccepted,
      consentTimestamp: now,
      internalClassification: result.category,
      leadScore: result.score,
      leadCategory: result.label,
      leadPriority: priority,
      leadStatus: "new",
    })
    .returning();

  if (!inserted) {
    return res.status(500).json({ error: "Failed to create lead" });
  }

  // Fire-and-forget classification_result analytics event
  db.insert(analyticsEventsTable)
    .values({
      eventName: "classification_result",
      leadId: inserted.id,
      referenceNumber: inserted.referenceNumber,
      payload: {
        category: result.category,
        label: result.label,
        score: result.score,
        priority,
      },
    })
    .catch((err) => req.log.error({ err }, "Failed to log analytics event"));

  // Fire-and-forget whatsapp capture analytics. NO PII — only the boolean
  // flag and the inquiry id (lead id) are stored.
  db.insert(analyticsEventsTable)
    .values({
      eventName: "lead.whatsapp_captured",
      leadId: inserted.id,
      referenceNumber: inserted.referenceNumber,
      payload: {
        inquiryId: inserted.id,
        hasWhatsapp:
          typeof inserted.whatsapp === "string" && inserted.whatsapp.length > 0,
      },
    })
    .catch((err) =>
      req.log.error({ err }, "Failed to log whatsapp_captured event"),
    );

  // Fresh insert: dispatch confirmation immediately, no cooldown.
  dispatchConfirmation(inserted, 0);

  return res.status(201).json(serializeLead(inserted));
});

router.get("/leads", async (req, res) => {
  // Admin-only: the list contains PII (full name, email, whatsapp number)
  // and internal CRM fields (priority, status).  The user-facing reference
  // lookup is `GET /leads/:referenceNumber`, which uses `serializeLeadPublic`
  // and is unaffected by this gate.
  if (!requireAdminToken(req, res)) return;

  const parsed = ListLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.issues });
  }
  const { limit = 50, priority, status, nationality, situation } = parsed.data;

  const filters = [];
  if (priority) filters.push(eq(prelaunchLeadsTable.leadPriority, priority));
  if (status) filters.push(eq(prelaunchLeadsTable.leadStatus, status));
  if (nationality)
    filters.push(eq(prelaunchLeadsTable.nationality, nationality));
  if (situation)
    filters.push(eq(prelaunchLeadsTable.immigrationSituation, situation));

  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(prelaunchLeadsTable.createdAt))
    .limit(limit);

  return res.json(rows.map(serializeLeadAdminList));
});

router.get("/leads/export.csv", async (req, res) => {
  // Admin-only: the export contains the same PII as `GET /leads`.  The
  // admin UI calls this with a fetch + `x-admin-token` header and triggers
  // the download via a Blob URL (so we never put the token in the URL).
  if (!requireAdminToken(req, res)) return;

  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .orderBy(desc(prelaunchLeadsTable.createdAt));

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = [
    "referenceNumber",
    "name",
    "email",
    "phone",
    "nationality",
    "classification",
    "score",
    "priority",
    "publicLabel",
    "status",
    "createdAt",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.referenceNumber,
        r.fullName,
        r.email,
        r.whatsapp,
        r.nationality,
        r.internalClassification,
        r.leadScore,
        r.leadPriority,
        r.leadCategory,
        r.leadStatus,
        r.createdAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const filename = `ema-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  return res.send(csv);
});

router.get("/leads/by-id/:id", async (req, res) => {
  // Admin-only: returns the full lead record including PII (email, whatsapp)
  // and operator-only `adminNotes`.  The user-facing reference lookup is
  // `GET /leads/:referenceNumber`, which uses `serializeLeadPublic`.
  if (!requireAdminToken(req, res)) return;

  const { id } = req.params;
  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return res.status(404).json({ error: "Lead not found" });
  }

  return res.json(serializeLead(rows[0]));
});

// NOTE: PATCH /leads/by-id/:id (status/notes editor) was removed and replaced
// by the token-gated PATCH /api/admin/leads/:id route in adminLeads.ts.  The
// old route was unauthenticated, which conflicts with the rule that
// admin-only mutations must remain admin-only.

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

  // Public lookup → strip internal CRM fields
  return res.json(serializeLeadPublic(rows[0]));
});

export default router;

// Keep sql import used for analytics; quiet TS unused warning
void sql;
