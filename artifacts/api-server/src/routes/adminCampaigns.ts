import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignRecipientsTable,
  prelaunchLeadsTable,
  leadEngagementsTable,
  type Campaign,
  type CampaignRecipient,
  type PrelaunchLead,
} from "@workspace/db";
import { requireAdminAuth } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";
import {
  AudienceQuerySchema,
  compileAudience,
  type AudienceQuery,
} from "../lib/audienceQuery";
import {
  leadToContext,
  renderTemplate,
  findUnknownTokens,
} from "../lib/campaignRender";
import { sendMessage } from "../lib/messaging";
import {
  buildUnsubscribeUrl,
  findUnsubscribed,
  canonicalContact,
} from "../lib/unsubscribe";
import { decideWaSend, executeWaDecision } from "../lib/whatsappCampaign";

// Phase 4 — Admin Campaign routes.
//
// Endpoints (all require admin session cookie):
//   GET    /api/admin/campaigns
//   POST   /api/admin/campaigns
//   GET    /api/admin/campaigns/:id
//   PATCH  /api/admin/campaigns/:id        (draft only)
//   DELETE /api/admin/campaigns/:id        (draft only)
//   POST   /api/admin/campaigns/:id/preview (count-only)
//   POST   /api/admin/campaigns/:id/test    (send single test to current admin)
//   POST   /api/admin/campaigns/:id/send    (synchronous bulk send, ≤200)

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hard cap, enforced server-side. Synchronous send + Resend's ~2 req/sec
// sustained limit means ~200 recipients ≈ 100 seconds wall clock. Above
// that we'd need a background worker — out of scope for V1.
const MAX_RECIPIENTS_PER_CAMPAIGN = 200;

const ChannelEnum = z.enum(["email", "whatsapp"]);

const CreateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel: ChannelEnum,
  templateSubject: z.string().trim().max(200).optional(),
  templateBody: z.string().trim().max(5000).optional(),
  whatsappTemplateSid: z.string().trim().max(120).optional(),
  audienceFilter: AudienceQuerySchema.optional(),
});

const PatchCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  templateSubject: z.string().trim().max(200).nullable().optional(),
  templateBody: z.string().trim().max(5000).nullable().optional(),
  whatsappTemplateSid: z.string().trim().max(120).nullable().optional(),
  audienceFilter: AudienceQuerySchema.nullable().optional(),
});

function serializeCampaign(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    status: c.status,
    templateSubject: c.templateSubject,
    templateBody: c.templateBody,
    whatsappTemplateSid: c.whatsappTemplateSid,
    audienceFilter: c.audienceFilter as AudienceQuery | null,
    audienceSnapshotCount: c.audienceSnapshotCount,
    recipientsTotal: c.recipientsTotal,
    recipientsSent: c.recipientsSent,
    recipientsFailed: c.recipientsFailed,
    recipientsSkipped: c.recipientsSkipped,
    recipientsUnsubscribed: c.recipientsUnsubscribed,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
  };
}

function serializeRecipient(r: CampaignRecipient) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    leadId: r.leadId,
    status: r.status,
    reason: r.reason,
    engagementId: r.engagementId,
    channelUsed: r.channelUsed,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// list

router.get("/admin/campaigns", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const rows = await db
    .select()
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.createdAt))
    .limit(200);

  return res.json(rows.map(serializeCampaign));
});

// ---------------------------------------------------------------------------
// create draft

router.post("/admin/campaigns", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const parsed = CreateCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid campaign payload",
      details: parsed.error.issues,
    });
  }

  const [row] = await db
    .insert(campaignsTable)
    .values({
      name: parsed.data.name,
      channel: parsed.data.channel,
      status: "draft",
      templateSubject: parsed.data.templateSubject ?? null,
      templateBody: parsed.data.templateBody ?? null,
      whatsappTemplateSid: parsed.data.whatsappTemplateSid ?? null,
      audienceFilter: parsed.data.audienceFilter ?? null,
      createdBy: req.adminUser?.id ?? null,
    })
    .returning();
  if (!row) {
    return res.status(500).json({ error: "Failed to create campaign" });
  }

  void writeAudit({
    req,
    action: "campaign_created",
    after: { campaignId: row.id, name: row.name, channel: row.channel },
  });

  return res.status(201).json(serializeCampaign(row));
});

// ---------------------------------------------------------------------------
// get one (with recipients)

router.get("/admin/campaigns/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  const recipients = await db
    .select({
      id: campaignRecipientsTable.id,
      campaignId: campaignRecipientsTable.campaignId,
      leadId: campaignRecipientsTable.leadId,
      status: campaignRecipientsTable.status,
      reason: campaignRecipientsTable.reason,
      engagementId: campaignRecipientsTable.engagementId,
      channelUsed: campaignRecipientsTable.channelUsed,
      sentAt: campaignRecipientsTable.sentAt,
      createdAt: campaignRecipientsTable.createdAt,
      leadName: prelaunchLeadsTable.fullName,
      leadEmail: prelaunchLeadsTable.email,
      leadWhatsapp: prelaunchLeadsTable.whatsapp,
      leadReference: prelaunchLeadsTable.referenceNumber,
    })
    .from(campaignRecipientsTable)
    .leftJoin(
      prelaunchLeadsTable,
      eq(prelaunchLeadsTable.id, campaignRecipientsTable.leadId),
    )
    .where(eq(campaignRecipientsTable.campaignId, id))
    .orderBy(desc(campaignRecipientsTable.createdAt))
    .limit(MAX_RECIPIENTS_PER_CAMPAIGN);

  return res.json({
    campaign: serializeCampaign(campaign),
    recipients: recipients.map((r) => ({
      ...serializeRecipient({
        id: r.id,
        campaignId: r.campaignId,
        leadId: r.leadId,
        status: r.status,
        reason: r.reason,
        engagementId: r.engagementId,
        channelUsed: r.channelUsed,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      }),
      leadName: r.leadName,
      leadEmail: r.leadEmail,
      leadWhatsapp: r.leadWhatsapp,
      leadReference: r.leadReference,
    })),
  });
});

// ---------------------------------------------------------------------------
// patch draft

router.patch("/admin/campaigns/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const parsed = PatchCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid campaign payload",
      details: parsed.error.issues,
    });
  }

  const [existing] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Campaign not found" });
  if (existing.status !== "draft") {
    return res
      .status(409)
      .json({ error: "Only draft campaigns can be edited" });
  }

  // Build a defined-only patch to preserve unspecified columns.
  const patch: Partial<Campaign> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.templateSubject !== undefined)
    patch.templateSubject = parsed.data.templateSubject;
  if (parsed.data.templateBody !== undefined)
    patch.templateBody = parsed.data.templateBody;
  if (parsed.data.whatsappTemplateSid !== undefined)
    patch.whatsappTemplateSid = parsed.data.whatsappTemplateSid;
  if (parsed.data.audienceFilter !== undefined)
    patch.audienceFilter = parsed.data.audienceFilter;

  const [updated] = await db
    .update(campaignsTable)
    .set(patch)
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "draft")),
    )
    .returning();
  if (!updated) {
    return res
      .status(409)
      .json({ error: "Campaign is no longer in draft state" });
  }

  return res.json(serializeCampaign(updated));
});

// ---------------------------------------------------------------------------
// delete draft

router.delete("/admin/campaigns/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const result = await db
    .delete(campaignsTable)
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "draft")),
    )
    .returning({ id: campaignsTable.id });
  if (result.length === 0) {
    return res
      .status(409)
      .json({ error: "Only draft campaigns can be deleted" });
  }

  void writeAudit({
    req,
    action: "campaign_deleted",
    after: { campaignId: id },
  });

  return res.status(204).end();
});

// ---------------------------------------------------------------------------
// preview audience count
//
// Cheap live counter that powers the editor's "this will reach N leads"
// chip. Compiles the audience filter, runs a single COUNT(*) and ALSO
// reports how many of those are currently on the unsubscribe list for the
// campaign's channel — the editor displays both so the operator sees the
// post-suppression delivery total before clicking Send.

router.post("/admin/campaigns/:id/preview", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const filter = (campaign.audienceFilter ?? null) as AudienceQuery | null;
  if (!filter || filter.rules.length === 0) {
    return res.json({
      total: 0,
      unsubscribedCount: 0,
      eligibleCount: 0,
      cap: MAX_RECIPIENTS_PER_CAMPAIGN,
    });
  }

  const where = compileAudience(filter);
  if (!where) {
    return res.json({
      total: 0,
      unsubscribedCount: 0,
      eligibleCount: 0,
      cap: MAX_RECIPIENTS_PER_CAMPAIGN,
    });
  }

  // Minimal projection so we can count + measure suppression in one round.
  const rows = await db
    .select({
      id: prelaunchLeadsTable.id,
      email: prelaunchLeadsTable.email,
      whatsapp: prelaunchLeadsTable.whatsapp,
    })
    .from(prelaunchLeadsTable)
    .where(where);

  const channel: "email" | "whatsapp" =
    campaign.channel === "whatsapp" ? "whatsapp" : "email";
  const contacts = rows
    .map((r) => (channel === "whatsapp" ? r.whatsapp : r.email))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const unsub = await findUnsubscribed(channel, contacts);
  let unsubscribedCount = 0;
  for (const c of contacts) {
    const canon = canonicalContact(channel, c);
    if (canon && unsub.has(canon)) unsubscribedCount++;
  }

  return res.json({
    total: rows.length,
    unsubscribedCount,
    eligibleCount: Math.max(0, rows.length - unsubscribedCount),
    cap: MAX_RECIPIENTS_PER_CAMPAIGN,
  });
});

// ---------------------------------------------------------------------------
// test-send: render the template with a synthetic context and send to the
// current admin's email (only). Never writes a recipient row, never touches
// the unsubscribe registry, never advances the campaign status.

router.post("/admin/campaigns/:id/test", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const adminEmail = req.adminUser?.email;
  if (!adminEmail) {
    return res.status(400).json({
      error:
        "Test send requires an authenticated admin with an email on file",
    });
  }

  const ctx = {
    fullName: req.adminUser?.displayName ?? "Test Admin",
    referenceNumber: "EMA-TEST-0000",
    organizationName: null,
  };
  const subject = `[TEST] ${renderTemplate(
    campaign.templateSubject ?? "Update from E-Migration Assist",
    ctx,
  )}`;
  const body = renderTemplate(campaign.templateBody ?? "", ctx);
  if (body.trim().length === 0) {
    return res.status(400).json({ error: "Template body is empty" });
  }

  // Test sends are always email — operator should receive a copy in their
  // inbox even if the campaign channel is WhatsApp. (Sending a WA test
  // would require routing it through the operator's WA number, which we
  // don't have on file.)
  const result = await sendMessage({
    channel: "email",
    to: adminEmail,
    message: body,
    subject,
  });

  void writeAudit({
    req,
    action: "campaign_test_sent",
    after: {
      campaignId: campaign.id,
      to: adminEmail,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
    },
  });

  return res.json({
    sent: result.ok,
    reason: result.ok ? null : result.reason,
  });
});

// ---------------------------------------------------------------------------
// SEND — the meaty one.
//
// Synchronous bulk send with hard ≤200 cap. Flow:
//   1. Atomically transition campaign draft → sending (refuse if not draft).
//      The UPDATE … WHERE status='draft' RETURNING * is the lock; a second
//      concurrent click sees zero rows and 409s.
//   2. Compile + run audience query. If 0 results or > 200, refuse and
//      revert the campaign to draft.
//   3. For each lead: build recipient row (transactional with engagement +
//      counter increment), call sendMessage(), set terminal status.
//   4. Mark campaign completed with final counts + sentAt.

router.post("/admin/campaigns/:id/send", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  // ── Step 1: claim the campaign ───────────────────────────────────────
  const [campaign] = await db
    .update(campaignsTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "draft")),
    )
    .returning();
  if (!campaign) {
    return res
      .status(409)
      .json({ error: "Campaign is not in draft state" });
  }

  // Helper to revert on early-exit conditions (empty audience, too large…).
  // We DON'T revert on per-recipient send failures — those are normal and
  // just produce a `failed` recipient row.
  const revertToDraft = async (reason: string) => {
    await db
      .update(campaignsTable)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(campaignsTable.id, id));
    req.log.info(
      { campaignId: id, reason },
      "Reverted campaign to draft after send refusal",
    );
  };

  const filter = (campaign.audienceFilter ?? null) as AudienceQuery | null;
  if (!filter || filter.rules.length === 0) {
    await revertToDraft("empty_filter");
    return res
      .status(400)
      .json({ error: "Campaign has no audience filter configured" });
  }

  const channelEnum: "email" | "whatsapp" =
    campaign.channel === "whatsapp" ? "whatsapp" : "email";

  const body = (campaign.templateBody ?? "").trim();
  if (channelEnum === "email") {
    if (body.length === 0) {
      await revertToDraft("empty_body");
      return res
        .status(400)
        .json({ error: "Email campaigns require a template body" });
    }
    if (findUnknownTokens(body).length > 0) {
      await revertToDraft("unknown_tokens");
      return res.status(400).json({
        error: "Template body contains unknown merge tokens",
        unknownTokens: findUnknownTokens(body),
      });
    }
  }

  const where = compileAudience(filter);
  if (!where) {
    await revertToDraft("compile_failed");
    return res
      .status(500)
      .json({ error: "Failed to compile audience filter" });
  }

  // ── Step 2: snapshot the audience ────────────────────────────────────
  let audience: PrelaunchLead[];
  try {
    audience = await db
      .select()
      .from(prelaunchLeadsTable)
      .where(where);
  } catch (err) {
    req.log.error({ err }, "Audience query failed");
    await revertToDraft("query_failed");
    return res.status(500).json({ error: "Failed to load audience" });
  }

  if (audience.length === 0) {
    await revertToDraft("empty_audience");
    return res
      .status(400)
      .json({ error: "Audience filter matched zero leads" });
  }
  if (audience.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
    await revertToDraft("over_cap");
    return res.status(413).json({
      error: `Audience of ${audience.length} exceeds the ${MAX_RECIPIENTS_PER_CAMPAIGN}-recipient cap. Tighten the filter and try again.`,
      audienceSize: audience.length,
      cap: MAX_RECIPIENTS_PER_CAMPAIGN,
    });
  }

  // ── Step 3: pre-load unsubscribed set in one query ───────────────────
  const contactsForChannel = audience
    .map((l) => (channelEnum === "whatsapp" ? l.whatsapp : l.email))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const unsubSet = await findUnsubscribed(channelEnum, contactsForChannel);

  // ── Step 4: snapshot count + audit start ─────────────────────────────
  await db
    .update(campaignsTable)
    .set({
      audienceSnapshotCount: audience.length,
      recipientsTotal: audience.length,
      updatedAt: new Date(),
    })
    .where(eq(campaignsTable.id, id));

  void writeAudit({
    req,
    action: "campaign_started",
    after: {
      campaignId: id,
      audienceSize: audience.length,
      channel: channelEnum,
    },
  });

  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "");
  if (channelEnum === "email" && !baseUrl) {
    await revertToDraft("missing_base_url");
    return res.status(500).json({
      error:
        "Email campaigns require PUBLIC_BASE_URL (or REPLIT_DEV_DOMAIN) so the unsubscribe link can be built. Refusing to send without it.",
    });
  }

  // ── Step 5: synchronous loop ─────────────────────────────────────────
  // Counters are tallied in-memory and flushed in a single UPDATE at the
  // end. Per-recipient state changes still write their own rows so the
  // detail page reflects in-progress sends if the operator opens it.
  //
  // The whole loop is wrapped in try/catch/finally so any uncaught provider
  // or DB exception still writes a terminal status to the campaign row —
  // we never leave the campaign stuck in `sending`.
  const tally = { sent: 0, failed: 0, skipped: 0, unsub: 0 };
  let runtimeError: unknown = null;
  try {
  for (const lead of audience) {
    const contact =
      channelEnum === "whatsapp" ? lead.whatsapp : lead.email;
    const canonical = canonicalContact(channelEnum, contact);

    // Insert the recipient row in `queued`. ON CONFLICT DO NOTHING handles
    // any operator-induced re-send to the same audience — second attempt
    // becomes a no-op for already-tracked leads. Since the campaign was
    // just claimed from `draft`, this is mostly defensive.
    const [recipient] = await db
      .insert(campaignRecipientsTable)
      .values({
        campaignId: id,
        leadId: lead.id,
        status: "queued",
      })
      .onConflictDoNothing({
        target: [
          campaignRecipientsTable.campaignId,
          campaignRecipientsTable.leadId,
        ],
      })
      .returning();
    if (!recipient) {
      // Already sent in a previous run; skip without re-sending. (Cannot
      // happen on a fresh draft, but defended for safety.)
      continue;
    }

    // Suppression check.
    if (canonical && unsubSet.has(canonical)) {
      await db
        .update(campaignRecipientsTable)
        .set({
          status: "unsubscribed",
          reason: "unsubscribed",
          channelUsed: channelEnum,
        })
        .where(eq(campaignRecipientsTable.id, recipient.id));
      tally.unsub++;
      continue;
    }

    // No-recipient skip (lead has no email / no WA).
    if (!canonical) {
      await db
        .update(campaignRecipientsTable)
        .set({
          status: "skipped",
          reason: "no_recipient",
          channelUsed: channelEnum,
        })
        .where(eq(campaignRecipientsTable.id, recipient.id));
      tally.skipped++;
      continue;
    }

    // Render per-lead body.
    const ctx = leadToContext(lead);
    const renderedBody = renderTemplate(campaign.templateBody ?? "", ctx);
    const renderedSubject = renderTemplate(
      campaign.templateSubject ?? "Update from E-Migration Assist",
      ctx,
    );

    // Append unsubscribe footer to email body. WA messages don't get a
    // footer: WhatsApp's "Block" / STOP keyword IS the unsubscribe path.
    let outboundBody = renderedBody;
    if (channelEnum === "email" && baseUrl) {
      const unsubUrl = buildUnsubscribeUrl(baseUrl, "email", canonical);
      outboundBody = `${renderedBody}\n\n—\nDon't want these emails? Unsubscribe: ${unsubUrl}`;
    }

    // Insert engagement row first (so a crash mid-send still leaves a
    // 'pending' row for forensic review).
    const [engagement] = await db
      .insert(leadEngagementsTable)
      .values({
        leadId: lead.id,
        channel: channelEnum,
        type: "manual",
        status: "pending",
        message: outboundBody,
      })
      .returning();

    // Dispatch.
    let ok = false;
    let reason: string | null = null;
    let channelUsed: string = channelEnum;
    if (channelEnum === "whatsapp") {
      const decision = await decideWaSend({
        leadId: lead.id,
        whatsapp: canonical,
        templateSid: campaign.whatsappTemplateSid ?? null,
        freeformBody: outboundBody,
      });
      const exec = await executeWaDecision({ to: canonical, decision });
      if (exec.ok) {
        ok = true;
        channelUsed = exec.channelUsed;
      } else {
        reason = exec.reason;
        if (decision.mode === "freeform") channelUsed = "whatsapp_freeform";
        else if (decision.mode === "template")
          channelUsed = "whatsapp_template";
      }
    } else {
      const result = await sendMessage({
        channel: "email",
        to: canonical,
        message: outboundBody,
        subject: renderedSubject,
        referenceNumber: lead.referenceNumber,
      });
      ok = result.ok;
      if (!result.ok) reason = result.reason;
    }

    // Persist terminal state on both rows.
    if (engagement) {
      await db
        .update(leadEngagementsTable)
        .set({ status: ok ? "sent" : "failed" })
        .where(eq(leadEngagementsTable.id, engagement.id));
    }
    await db
      .update(campaignRecipientsTable)
      .set({
        status: ok ? "sent" : "failed",
        reason,
        engagementId: engagement?.id ?? null,
        channelUsed,
        sentAt: new Date(),
      })
      .where(eq(campaignRecipientsTable.id, recipient.id));

    if (ok) tally.sent++;
    else tally.failed++;
  }
  } catch (err) {
    runtimeError = err;
    req.log.error({ err, campaignId: id }, "Campaign send loop crashed");
  }

  // ── Step 6: finalize counters + status ───────────────────────────────
  // On uncaught exception we still mark the campaign terminal — `cancelled`
  // — so it can never get stuck in `sending`. Operator can inspect the
  // recipients table to see how far the run got.
  const finalStatus = runtimeError ? "cancelled" : "completed";
  const [final] = await db
    .update(campaignsTable)
    .set({
      status: finalStatus,
      sentAt: new Date(),
      updatedAt: new Date(),
      recipientsSent: tally.sent,
      recipientsFailed: tally.failed,
      recipientsSkipped: tally.skipped,
      recipientsUnsubscribed: tally.unsub,
    })
    .where(eq(campaignsTable.id, id))
    .returning();

  void writeAudit({
    req,
    action: "campaign_completed",
    after: {
      campaignId: id,
      tally,
    },
  });

  if (runtimeError) {
    return res.status(500).json({
      error: "Campaign send aborted due to runtime error; marked cancelled.",
      campaign: final ? serializeCampaign(final) : null,
      tally,
    });
  }
  return res.json({
    campaign: final ? serializeCampaign(final) : null,
    tally,
  });
});

// suppress unused warnings for `sql` import (kept available for future
// per-row counter updates if we move to incremental flushing)
void sql;

export default router;
