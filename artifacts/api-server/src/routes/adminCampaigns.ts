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
import { sanitizeEmailHtml } from "../lib/htmlSanitize";
import { sendMessage } from "../lib/messaging";
import {
  buildUnsubscribeUrl,
  findUnsubscribed,
  canonicalContact,
} from "../lib/unsubscribe";
import { decideWaSend, executeWaDecision } from "../lib/whatsappCampaign";
import { enqueueCampaignSends, isQueueReady } from "../lib/queue";

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

// Hard cap, enforced server-side. Phase 6D-3A moved per-recipient sends
// into a pg-boss queue (`lib/queue.ts` + `lib/campaignSendWorker.ts`),
// so the route is no longer wall-clock-bound by Resend's rate limit.
// Cap raised 200 → 2000 — the new ceiling is set by Resend free-tier
// monthly volume + the polling/concurrency model in the worker, not
// by the HTTP request lifetime.
const MAX_RECIPIENTS_PER_CAMPAIGN = 2000;

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
// stats — DB-only aggregates for the Communications → Reports tab.
// Open/click rates are intentionally omitted (no provider webhooks wired
// yet); this surface only reports facts the DB already knows.

router.get("/admin/campaigns/stats", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const [totals] = await db
    .select({
      totalCampaigns: sql<number>`count(*)::int`,
      drafts: sql<number>`count(*) filter (where ${campaignsTable.status} = 'draft')::int`,
      sending: sql<number>`count(*) filter (where ${campaignsTable.status} = 'sending')::int`,
      completed: sql<number>`count(*) filter (where ${campaignsTable.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${campaignsTable.status} = 'cancelled')::int`,
      emailCampaigns: sql<number>`count(*) filter (where ${campaignsTable.channel} = 'email')::int`,
      whatsappCampaigns: sql<number>`count(*) filter (where ${campaignsTable.channel} = 'whatsapp')::int`,
      recipientsTotal: sql<number>`coalesce(sum(${campaignsTable.recipientsTotal}), 0)::int`,
      recipientsSent: sql<number>`coalesce(sum(${campaignsTable.recipientsSent}), 0)::int`,
      recipientsFailed: sql<number>`coalesce(sum(${campaignsTable.recipientsFailed}), 0)::int`,
      recipientsSkipped: sql<number>`coalesce(sum(${campaignsTable.recipientsSkipped}), 0)::int`,
      recipientsUnsubscribed: sql<number>`coalesce(sum(${campaignsTable.recipientsUnsubscribed}), 0)::int`,
    })
    .from(campaignsTable);

  const recent = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      channel: campaignsTable.channel,
      status: campaignsTable.status,
      recipientsTotal: campaignsTable.recipientsTotal,
      recipientsSent: campaignsTable.recipientsSent,
      recipientsFailed: campaignsTable.recipientsFailed,
      sentAt: campaignsTable.sentAt,
      createdAt: campaignsTable.createdAt,
    })
    .from(campaignsTable)
    .orderBy(desc(campaignsTable.sentAt), desc(campaignsTable.createdAt))
    .limit(10);

  return res.json({
    totals: totals ?? {
      totalCampaigns: 0,
      drafts: 0,
      sending: 0,
      completed: 0,
      cancelled: 0,
      emailCampaigns: 0,
      whatsappCampaigns: 0,
      recipientsTotal: 0,
      recipientsSent: 0,
      recipientsFailed: 0,
      recipientsSkipped: 0,
      recipientsUnsubscribed: 0,
    },
    recent: recent.map((r) => ({
      id: r.id,
      name: r.name,
      channel: r.channel,
      status: r.status,
      recipientsTotal: r.recipientsTotal,
      recipientsSent: r.recipientsSent,
      recipientsFailed: r.recipientsFailed,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
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

  // ── Step 0: queue-readiness gate ─────────────────────────────────────
  // Architect-flagged: if the queue isn't up yet (boot race, pgboss
  // schema-create failure, transient DB hiccup), refuse the send WITHOUT
  // claiming the campaign. Returning 503 + leaving the row in `draft`
  // lets the operator retry once the queue heals. The previous design
  // would atomically claim → fail to enqueue → flip to `cancelled`,
  // permanently burying a valid draft.
  if (!isQueueReady()) {
    return res.status(503).json({
      error:
        "Send queue is not ready yet. Wait a few seconds for the API to finish booting, then try again.",
    });
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

  // ── Step 5: create recipient rows + enqueue jobs ─────────────────────
  // Phase 6D-3A: per-recipient sends moved into the pg-boss queue. The
  // route's job is now to materialise `queued` recipient rows for every
  // audience lead (so the detail page renders in-progress state
  // immediately) and hand them off to the worker. Counters and the
  // `completed` finalise are written by the worker as recipients settle.
  const recipientIds: string[] = [];
  let preCounted = { skipped: 0, unsub: 0 };
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
      // Already tracked in a previous run (defensive — fresh draft means
      // this can't normally happen). Skip enqueue.
      continue;
    }

    // Pre-settle suppressions and no-recipient skips at the route. The
    // worker would handle these too, but settling here saves a job
    // round-trip + a fresh unsub query for already-known-bad recipients,
    // and surfaces accurate counters before the queue even ticks.
    if (canonical && unsubSet.has(canonical)) {
      await db
        .update(campaignRecipientsTable)
        .set({
          status: "unsubscribed",
          reason: "unsubscribed",
          channelUsed: channelEnum,
        })
        .where(eq(campaignRecipientsTable.id, recipient.id));
      preCounted.unsub++;
      continue;
    }
    if (!canonical) {
      await db
        .update(campaignRecipientsTable)
        .set({
          status: "skipped",
          reason: "no_recipient",
          channelUsed: channelEnum,
        })
        .where(eq(campaignRecipientsTable.id, recipient.id));
      preCounted.skipped++;
      continue;
    }

    // Eligible — leave row in `queued` and enqueue a job.
    recipientIds.push(recipient.id);
  }
  } catch (err) {
    runtimeError = err;
    req.log.error({ err, campaignId: id }, "Recipient materialisation failed");
  }

  // Flush pre-settled counters in a single UPDATE so the campaign row
  // shows them before the worker starts ticking.
  if (preCounted.skipped > 0 || preCounted.unsub > 0) {
    await db
      .update(campaignsTable)
      .set({
        recipientsSkipped: sql`${campaignsTable.recipientsSkipped} + ${preCounted.skipped}`,
        recipientsUnsubscribed: sql`${campaignsTable.recipientsUnsubscribed} + ${preCounted.unsub}`,
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, id));
  }

  if (runtimeError) {
    // Couldn't even materialise the recipients table — abort, mark cancelled.
    const [final] = await db
      .update(campaignsTable)
      .set({
        status: "cancelled",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, id))
      .returning();
    void writeAudit({
      req,
      action: "campaign_cancelled",
      after: { campaignId: id, reason: "materialisation_failed" },
    });
    return res.status(500).json({
      error: "Campaign send aborted; marked cancelled.",
      campaign: final ? serializeCampaign(final) : null,
    });
  }

  // ── Step 6: enqueue queue jobs (batch insert) ────────────────────────
  // pg-boss `insert` is one round-trip regardless of count — critical at
  // the new 2000 cap (would otherwise be 2000 INSERTs).
  if (recipientIds.length > 0) {
    try {
      await enqueueCampaignSends(
        recipientIds.map((recipientId) => ({
          campaignId: id,
          recipientId,
          baseUrl,
        })),
      );
    } catch (err) {
      req.log.error(
        { err, campaignId: id, queued: recipientIds.length },
        "Failed to enqueue campaign jobs",
      );
      const [final] = await db
        .update(campaignsTable)
        .set({
          status: "cancelled",
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(campaignsTable.id, id))
        .returning();
      return res.status(500).json({
        error: "Failed to enqueue send jobs; campaign marked cancelled.",
        campaign: final ? serializeCampaign(final) : null,
      });
    }
  } else if (preCounted.skipped + preCounted.unsub === audience.length) {
    // Every recipient was pre-settled (all unsubscribed or no-contact) —
    // nothing for the worker to do, finalise immediately.
    await db
      .update(campaignsTable)
      .set({
        status: "completed",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, id));
  }

  // Read back the campaign with the freshly-flushed pre-settled counters.
  const [campaignAfter] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);

  void writeAudit({
    req,
    action: "campaign_send_enqueued",
    after: {
      campaignId: id,
      audienceSize: audience.length,
      queued: recipientIds.length,
      preSettled: preCounted,
    },
  });

  return res.status(202).json({
    campaign: campaignAfter ? serializeCampaign(campaignAfter) : null,
    queued: recipientIds.length,
    preSettled: preCounted,
  });
});

// suppress unused warnings for `sql` import (kept available for future
// per-row counter updates if we move to incremental flushing)
void sql;

export default router;
