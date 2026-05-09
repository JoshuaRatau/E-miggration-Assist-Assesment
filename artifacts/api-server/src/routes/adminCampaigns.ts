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
import {
  dispatchClaimedCampaign,
  MAX_RECIPIENTS_PER_CAMPAIGN as MAX_RECIPIENTS_FROM_DISPATCH,
} from "../lib/campaignDispatch";
import { maybeFinaliseCampaign } from "../lib/campaignSendWorker";

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

// Re-exported from `lib/campaignDispatch.ts` (single source of truth so
// the scheduled-send worker uses the same ceiling). Phase 6D-3A moved
// per-recipient sends into a pg-boss queue, so the route is no longer
// wall-clock-bound by Resend's rate limit.
const MAX_RECIPIENTS_PER_CAMPAIGN = MAX_RECIPIENTS_FROM_DISPATCH;

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
    scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
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
      scheduled: sql<number>`count(*) filter (where ${campaignsTable.status} = 'scheduled')::int`,
      sending: sql<number>`count(*) filter (where ${campaignsTable.status} = 'sending')::int`,
      paused: sql<number>`count(*) filter (where ${campaignsTable.status} = 'paused')::int`,
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
      scheduled: 0,
      sending: 0,
      paused: 0,
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
  // Phase 6D-3B — `scheduled` campaigns are also editable until the
  // scheduler claims them (the dispatch path re-runs at fire time, so
  // last-minute audience/body changes are honoured). The atomic UPDATE
  // below uses `status IN (draft, scheduled)` so we don't trample a row
  // mid-claim — the scheduler's own UPDATE flips status='sending' first,
  // and our WHERE will then return 0 rows = 409.
  if (existing.status !== "draft" && existing.status !== "scheduled") {
    return res
      .status(409)
      .json({ error: "Only draft or scheduled campaigns can be edited" });
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
      and(
        eq(campaignsTable.id, id),
        sql`${campaignsTable.status} in ('draft','scheduled')`,
      ),
    )
    .returning();
  if (!updated) {
    return res
      .status(409)
      .json({ error: "Campaign is no longer editable" });
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
// SEND — synchronous claim, async dispatch.
//
// Flow (Phase 6D-3A + 6D-3B refactor):
//   0. Queue-readiness gate (503 if pg-boss not yet up; leaves draft alone).
//   1. Atomic draft → sending claim. Concurrent click 409s.
//   2. Hand off to `dispatchClaimedCampaign` (shared with the scheduled-send
//      worker). The helper handles audience compile, materialise, pre-settle,
//      enqueue, and self-reverts to draft / cancelled on failure.
//   3. Audit + 202 with {campaign, queued, preSettled}.

router.post("/admin/campaigns/:id/send", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  if (!isQueueReady()) {
    return res.status(503).json({
      error:
        "Send queue is not ready yet. Wait a few seconds for the API to finish booting, then try again.",
    });
  }

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

  void writeAudit({
    req,
    action: "campaign_started",
    after: { campaignId: id, channel: campaign.channel },
  });

  const outcome = await dispatchClaimedCampaign({ campaign, log: req.log });
  if (!outcome.ok) {
    void writeAudit({
      req,
      action: outcome.cancelled
        ? "campaign_cancelled"
        : "campaign_send_refused",
      after: { campaignId: id, reason: outcome.reason },
    });
    return res.status(outcome.status).json({
      error: outcome.message,
      campaign: outcome.campaign ? serializeCampaign(outcome.campaign) : null,
    });
  }

  void writeAudit({
    req,
    action: "campaign_send_enqueued",
    after: {
      campaignId: id,
      queued: outcome.queued,
      preSettled: outcome.preSettled,
    },
  });

  return res.status(202).json({
    campaign: serializeCampaign(outcome.campaign),
    queued: outcome.queued,
    preSettled: outcome.preSettled,
  });
});

// ---------------------------------------------------------------------------
// Phase 6D-3B — schedule / unschedule / pause / resume
//
// Schedule: draft → scheduled (with `scheduled_at`). Picked up by
//   `lib/campaignScheduleWorker.ts` (30s tick) when scheduled_at <= now.
// Unschedule: scheduled → draft. Editable again.
// Pause: sending → paused. In-flight workers complete their current
//   recipient (atomic claim already won) but no NEW recipients are
//   started — the per-recipient worker checks campaign.status before
//   each dispatch and settles 'queued' rows as 'skipped' if paused.
// Resume: paused → sending. Re-enqueues all 'queued' recipients (the
//   pause may have happened mid-batch leaving rows that the worker
//   already pre-settled-as-skipped; those terminal rows are NOT
//   re-enqueued, only ones still in queued state).

const ScheduleCampaignSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
});

// Max 90 days in the future — guards against accidental year-2099 typos
// that would silently never fire. Enforced at the API; UI also caps.
const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;

router.post("/admin/campaigns/:id/schedule", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const parsed = ScheduleCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "scheduledAt must be an ISO 8601 timestamp",
      details: parsed.error.issues,
    });
  }
  const scheduledAt = new Date(parsed.data.scheduledAt);
  const now = Date.now();
  if (scheduledAt.getTime() <= now + 30_000) {
    return res.status(400).json({
      error:
        "scheduledAt must be at least 30 seconds in the future. To send now, use POST /:id/send.",
    });
  }
  if (scheduledAt.getTime() > now + MAX_SCHEDULE_AHEAD_MS) {
    return res.status(400).json({
      error: "scheduledAt cannot be more than 90 days in the future",
    });
  }

  // We do NOT pre-validate audience/body here — the scheduler worker
  // will run the same dispatch path at fire time and revert to draft if
  // anything's wrong. This lets operators schedule campaigns whose
  // audience may grow / body may be edited up until execution. Only
  // requirement: the campaign exists and is currently in draft.
  const [updated] = await db
    .update(campaignsTable)
    .set({
      status: "scheduled",
      scheduledAt,
      updatedAt: new Date(),
    })
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "draft")),
    )
    .returning();
  if (!updated) {
    return res
      .status(409)
      .json({ error: "Campaign must be in draft to schedule" });
  }

  void writeAudit({
    req,
    action: "campaign_scheduled",
    after: { campaignId: id, scheduledAt: scheduledAt.toISOString() },
  });

  return res.json({ campaign: serializeCampaign(updated) });
});

router.post("/admin/campaigns/:id/unschedule", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const [updated] = await db
    .update(campaignsTable)
    .set({
      status: "draft",
      scheduledAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "scheduled")),
    )
    .returning();
  if (!updated) {
    return res
      .status(409)
      .json({ error: "Campaign is not currently scheduled" });
  }

  void writeAudit({
    req,
    action: "campaign_unscheduled",
    after: { campaignId: id },
  });

  return res.json({ campaign: serializeCampaign(updated) });
});

router.post("/admin/campaigns/:id/pause", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const [updated] = await db
    .update(campaignsTable)
    .set({ status: "paused", updatedAt: new Date() })
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "sending")),
    )
    .returning();
  if (!updated) {
    return res
      .status(409)
      .json({ error: "Only sending campaigns can be paused" });
  }

  void writeAudit({ req, action: "campaign_paused", after: { campaignId: id } });

  return res.json({ campaign: serializeCampaign(updated) });
});

router.post("/admin/campaigns/:id/resume", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  if (!isQueueReady()) {
    return res.status(503).json({
      error:
        "Send queue is not ready yet. Wait a few seconds for the API to finish booting, then try again.",
    });
  }

  const [updated] = await db
    .update(campaignsTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      and(eq(campaignsTable.id, id), eq(campaignsTable.status, "paused")),
    )
    .returning();
  if (!updated) {
    return res
      .status(409)
      .json({ error: "Only paused campaigns can be resumed" });
  }

  // Re-enqueue every recipient still in 'queued'. The atomic claim in
  // the worker (queued→sending) means already-in-flight recipients
  // simply no-op a duplicate job. baseUrl mirrors the send route's
  // resolution for consistent unsubscribe footers.
  const queuedRecipients = await db
    .select({ id: campaignRecipientsTable.id })
    .from(campaignRecipientsTable)
    .where(
      and(
        eq(campaignRecipientsTable.campaignId, id),
        eq(campaignRecipientsTable.status, "queued"),
      ),
    );

  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "");

  if (queuedRecipients.length > 0) {
    try {
      await enqueueCampaignSends(
        queuedRecipients.map((r) => ({
          campaignId: id,
          recipientId: r.id,
          baseUrl,
        })),
      );
    } catch (err) {
      req.log.error(
        { err, campaignId: id },
        "Resume: failed to re-enqueue recipients",
      );
      // Don't roll the status back to paused — the operator pressed
      // Resume and the campaign IS now in 'sending'; some recipients
      // may already be in flight from before pause. They'll continue
      // and finalise normally. The newly-queued ones won't fire until
      // the next manual resume — surface that.
      return res.status(500).json({
        error:
          "Resume succeeded but re-enqueueing pending recipients failed. Try Resume again.",
        campaign: serializeCampaign(updated),
      });
    }
  }

  // Architect-flagged safety finalizer. If the pause happened after
  // the worker already drained every queued recipient (counters already
  // meet recipientsTotal), the resume would otherwise leave the
  // campaign stuck in 'sending' forever — no jobs to run, no worker
  // tick to call maybeFinalise. The atomic finaliser is a no-op when
  // counters < total, so it's safe to always call.
  await maybeFinaliseCampaign(id);

  void writeAudit({
    req,
    action: "campaign_resumed",
    after: { campaignId: id, requeued: queuedRecipients.length },
  });

  // Re-read in case the safety finaliser flipped status to completed.
  const [final] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);

  return res.json({
    campaign: serializeCampaign(final ?? updated),
    requeued: queuedRecipients.length,
  });
});

// ---------------------------------------------------------------------------
// (Legacy send body removed — see dispatchClaimedCampaign in
// `lib/campaignDispatch.ts` for the shared materialise + enqueue path.)


// suppress unused warnings for `sql` import (kept available for future
// per-row counter updates if we move to incremental flushing)
void sql;

export default router;
