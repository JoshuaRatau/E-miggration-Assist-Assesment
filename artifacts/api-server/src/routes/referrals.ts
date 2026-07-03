import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  prelaunchLeadsTable,
  partnerFirmsTable,
  referralsTable,
  referralAuditTable,
} from "@workspace/db";
import { requireAdminAuth } from "../lib/adminAuth";
import { writeReferralAudit } from "../lib/referralAudit";
import { deriveReferralPreview, matchPartnerFirm } from "../lib/referralService";
import { sendInternalNotificationEmail } from "../lib/email";
import { isTunnelConfigured } from "../lib/referralTunnel";

const router: IRouter = Router();

/** Human-readable, unique referral id used across the whole tunnel. */
function generateReferralId(): string {
  const year = new Date().getUTCFullYear();
  const rand = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `EMA-REF-${year}-${rand}`;
}

/** Public base URL of THIS funnel (for building the secure preview link). */
function funnelBaseUrl(): string | null {
  const explicit = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}`;
  return null;
}

// ---------------------------------------------------------------------------
// PUBLIC — POPIA consent + referral creation (§4.1)
//
// Consent is FIRST: no referral is ever created, and no firm is ever offered,
// without a recorded, explicit consent-to-share. Fails closed otherwise.
// ---------------------------------------------------------------------------

const ConsentBody = z.object({
  referenceNumber: z.string().min(1),
  consentToShareWithPartnerFirms: z.literal(true),
  consentTextVersion: z.string().min(1).max(64).optional(),
  consentSourcePage: z.string().min(1).max(200).optional(),
});

router.post("/referrals/consent", async (req, res) => {
  const parsed = ConsentBody.safeParse(req.body);
  if (!parsed.success) {
    // A missing / false consent flag lands here — fail closed.
    return res
      .status(400)
      .json({ error: "consent_required", detail: parsed.error.flatten() });
  }
  const {
    referenceNumber,
    consentTextVersion,
    consentSourcePage,
  } = parsed.data;

  // Serialise concurrent consent calls for the same lead: lock the lead row
  // FOR UPDATE inside a transaction, re-check for an existing referral under
  // the lock, then create. This closes the read-then-insert race that could
  // otherwise mint duplicate referrals for a single lead.
  const outcome = await db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(prelaunchLeadsTable)
      .where(eq(prelaunchLeadsTable.referenceNumber, referenceNumber))
      .limit(1)
      .for("update");

    if (!lead) {
      return { kind: "not_found" as const };
    }

    // Idempotency: if this lead already has a referral, return it rather
    // than creating a duplicate.
    const [existing] = await tx
      .select()
      .from(referralsTable)
      .where(eq(referralsTable.leadId, lead.id))
      .orderBy(desc(referralsTable.createdAt))
      .limit(1);
    if (existing) {
      return {
        kind: "existing" as const,
        referralId: existing.referralId,
        status: existing.status,
      };
    }

    const preview = deriveReferralPreview(lead);
    const firm = await matchPartnerFirm({
      matterType: preview.matterType,
      region: preview.region,
    });

    const now = new Date();
    const referralId = generateReferralId();

    await tx.insert(referralsTable).values({
      referralId,
      leadId: lead.id,
      funnelFirmId: firm?.id ?? null,
      status: "offered",
      matterType: preview.matterType,
      urgency: preview.urgency,
      region: preview.region,
      summary: preview.summary,
      consentToShare: true,
      consentTextVersion: consentTextVersion ?? "v1",
      consentSourcePage: consentSourcePage ?? null,
      consentIp: req.ip ?? null,
      consentUserAgent: req.header("user-agent") ?? null,
      consentAt: now,
      offeredAt: now,
    });

    return {
      kind: "created" as const,
      referralId,
      matched: Boolean(firm),
      firmId: firm?.id ?? null,
      firmContactEmail: firm?.contactEmail ?? null,
      preview,
    };
  });

  if (outcome.kind === "not_found") {
    return res.status(404).json({ error: "lead_not_found" });
  }
  if (outcome.kind === "existing") {
    return res
      .status(200)
      .json({ referralId: outcome.referralId, status: outcome.status });
  }

  // New referral created — write the audit trail and fire the firm offer
  // email AFTER the transaction has committed.
  await writeReferralAudit(outcome.referralId, "consent_recorded", {
    consentTextVersion: consentTextVersion ?? "v1",
    matched: outcome.matched,
  });
  await writeReferralAudit(outcome.referralId, "offered", {
    funnelFirmId: outcome.firmId,
  });

  // Fire-and-forget offer email to the matched firm — secure preview link
  // only, NO applicant PII.
  if (outcome.firmContactEmail) {
    const base = funnelBaseUrl();
    const previewLink = base
      ? `${base}/referral-preview/${outcome.referralId}`
      : `(configure PUBLIC_BASE_URL) /referral-preview/${outcome.referralId}`;
    void sendInternalNotificationEmail({
      to: outcome.firmContactEmail,
      subject: `New referral preview — ${outcome.preview.matterType} [${outcome.referralId}]`,
      text: [
        `A new immigration referral matching your firm is available.`,
        ``,
        `Matter type: ${outcome.preview.matterType}`,
        `Urgency: ${outcome.preview.urgency}`,
        `Region: ${outcome.preview.region}`,
        ``,
        `View the secure referral preview (no personal details are shown until you accept and open it in EMA):`,
        previewLink,
        ``,
        `Reference: ${outcome.referralId}`,
        ``,
        `— E-Migration Assist`,
      ].join("\n"),
    });
  }

  return res.status(201).json({
    referralId: outcome.referralId,
    status: "offered",
    matched: outcome.matched,
  });
});

// ---------------------------------------------------------------------------
// PUBLIC — redacted preview (§4.3). NON-IDENTIFYING fields only.
// ---------------------------------------------------------------------------

router.get("/referrals/preview/:referralId", async (req, res) => {
  const referralId = req.params.referralId;
  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.referralId, referralId))
    .limit(1);

  if (!referral) {
    return res.status(404).json({ error: "referral_not_found" });
  }

  // First view flips offered → preview_viewed (idempotent).
  if (referral.status === "offered") {
    await db
      .update(referralsTable)
      .set({
        status: "preview_viewed",
        previewViewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(referralsTable.referralId, referralId),
          eq(referralsTable.status, "offered"),
        ),
      );
    await writeReferralAudit(referralId, "preview_viewed");
  }

  return res.status(200).json({
    referralId: referral.referralId,
    status: referral.status === "offered" ? "preview_viewed" : referral.status,
    matterType: referral.matterType,
    urgency: referral.urgency,
    region: referral.region,
    summary: referral.summary,
    tunnelReady: isTunnelConfigured(),
  });
});

// ---------------------------------------------------------------------------
// ADMIN — referral board (list + detail). NO applicant PII exposed.
// ---------------------------------------------------------------------------

router.get("/admin/referrals", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const rows = await db
    .select()
    .from(referralsTable)
    .orderBy(desc(referralsTable.createdAt))
    .limit(500);
  return res.status(200).json({ referrals: rows });
});

router.get("/admin/referrals/:referralId", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const referralId = req.params.referralId;
  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.referralId, referralId))
    .limit(1);
  if (!referral) return res.status(404).json({ error: "referral_not_found" });

  const audit = await db
    .select()
    .from(referralAuditTable)
    .where(eq(referralAuditTable.referralId, referralId))
    .orderBy(desc(referralAuditTable.createdAt))
    .limit(100);

  return res.status(200).json({ referral, audit });
});

// ---------------------------------------------------------------------------
// ADMIN — partner firm management (matching targets).
// ---------------------------------------------------------------------------

const PartnerFirmBody = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email().optional(),
  matterTypes: z.array(z.string().min(1)).optional(),
  regions: z.array(z.string().min(1)).optional(),
  capacity: z.number().int().min(0).optional(),
  vettingStatus: z.enum(["prospect", "vetted", "suspended"]).optional(),
  active: z.boolean().optional(),
});

router.get("/admin/partner-firms", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const rows = await db
    .select()
    .from(partnerFirmsTable)
    .orderBy(desc(partnerFirmsTable.createdAt));
  return res.status(200).json({ firms: rows });
});

router.post("/admin/partner-firms", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const parsed = PartnerFirmBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_body", detail: parsed.error.flatten() });
  }
  const [firm] = await db
    .insert(partnerFirmsTable)
    .values({
      name: parsed.data.name,
      contactEmail: parsed.data.contactEmail ?? null,
      matterTypes: parsed.data.matterTypes ?? null,
      regions: parsed.data.regions ?? null,
      capacity: parsed.data.capacity ?? null,
      vettingStatus: parsed.data.vettingStatus ?? "prospect",
      active: parsed.data.active ?? true,
    })
    .returning();
  return res.status(201).json({ firm });
});

export const referralsRouter = router;
export default router;
