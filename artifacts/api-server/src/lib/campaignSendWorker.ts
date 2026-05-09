import { and, eq, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignRecipientsTable,
  prelaunchLeadsTable,
  leadEngagementsTable,
  leadAuditTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sanitizeEmailHtml } from "./htmlSanitize";
import { leadToContext, renderTemplate } from "./campaignRender";
import { sendMessage } from "./messaging";
import {
  buildUnsubscribeUrl,
  findUnsubscribed,
  canonicalContact,
} from "./unsubscribe";
import { decideWaSend, executeWaDecision } from "./whatsappCampaign";

// Phase 6D-3A — per-recipient send worker.
//
// Invoked by pg-boss for each recipient. Designed to be:
//   1. Idempotent: atomic claim from `queued -> sending` so a retried job
//      never double-sends. If the row is no longer `queued`, the worker
//      no-ops.
//   2. Self-contained: re-loads campaign + lead from DB rather than
//      trusting the job payload, so an out-of-date payload (operator
//      edits a draft after enqueue — currently impossible since send
//      flips status off draft, but future-proof) cannot poison a send.
//   3. Counter-safe: increments aggregate counters on `campaigns` via
//      `col = col + 1` so concurrent worker writes don't race.
//   4. Self-finalising: every terminal recipient transition runs an
//      atomic UPDATE that flips the campaign to `completed` IFF
//      sent+failed+skipped+unsub >= total. Whichever job processes the
//      last recipient is the one that wins the finalise race.
//
// V1 known gap: if the API process crashes between the atomic
// `queued -> sending` claim and the terminal status write, the
// recipient row stays in `sending` until the operator resets it
// manually. pg-boss's `expireInHours: 1` will retry the job, but the
// retry will see `status != 'queued'` and no-op. Acceptable for a
// single-replica deploy with monitored uptime.

export interface CampaignSendJobData {
  campaignId: string;
  recipientId: string;
  baseUrl: string;
}

type CounterKey =
  | "recipientsSent"
  | "recipientsFailed"
  | "recipientsSkipped"
  | "recipientsUnsubscribed";

const COUNTER_COL = {
  recipientsSent: campaignsTable.recipientsSent,
  recipientsFailed: campaignsTable.recipientsFailed,
  recipientsSkipped: campaignsTable.recipientsSkipped,
  recipientsUnsubscribed: campaignsTable.recipientsUnsubscribed,
} as const;

async function bumpCounter(
  campaignId: string,
  key: CounterKey,
): Promise<void> {
  const col = COUNTER_COL[key];
  await db
    .update(campaignsTable)
    .set({ [key]: sql`${col} + 1`, updatedAt: new Date() })
    .where(eq(campaignsTable.id, campaignId));
}

async function maybeFinalise(campaignId: string): Promise<void> {
  // Atomic finalise. The WHERE clause guarantees exactly one worker
  // wins this transition — `status='sending'` filters out an already-
  // finalised campaign, and the terminal-count predicate ensures we
  // only fire when the LAST recipient has just settled.
  const [final] = await db
    .update(campaignsTable)
    .set({
      status: "completed",
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(campaignsTable.id, campaignId),
        eq(campaignsTable.status, "sending"),
        sql`(${campaignsTable.recipientsSent} + ${campaignsTable.recipientsFailed} + ${campaignsTable.recipientsSkipped} + ${campaignsTable.recipientsUnsubscribed}) >= ${campaignsTable.recipientsTotal}`,
      ),
    )
    .returning();

  if (final) {
    try {
      await db.insert(leadAuditTable).values({
        action: "campaign_completed",
        before: null,
        after: {
          campaignId,
          tally: {
            sent: final.recipientsSent,
            failed: final.recipientsFailed,
            skipped: final.recipientsSkipped,
            unsub: final.recipientsUnsubscribed,
          },
          completedBy: "system:queue",
        },
      });
    } catch (err) {
      logger.warn({ err, campaignId }, "Failed to write completion audit");
    }
    logger.info(
      {
        campaignId,
        sent: final.recipientsSent,
        failed: final.recipientsFailed,
        skipped: final.recipientsSkipped,
        unsub: final.recipientsUnsubscribed,
      },
      "Campaign finalised",
    );
  }
}

async function settleRecipient(args: {
  recipientId: string;
  campaignId: string;
  status: "sent" | "failed" | "skipped" | "unsubscribed";
  reason: string | null;
  channelUsed: string;
  engagementId: string | null;
}): Promise<void> {
  await db
    .update(campaignRecipientsTable)
    .set({
      status: args.status,
      reason: args.reason,
      channelUsed: args.channelUsed,
      engagementId: args.engagementId,
      sentAt: new Date(),
    })
    .where(eq(campaignRecipientsTable.id, args.recipientId));

  const counterKey: CounterKey =
    args.status === "sent"
      ? "recipientsSent"
      : args.status === "failed"
        ? "recipientsFailed"
        : args.status === "unsubscribed"
          ? "recipientsUnsubscribed"
          : "recipientsSkipped";
  await bumpCounter(args.campaignId, counterKey);
  await maybeFinalise(args.campaignId);
}

export async function handleCampaignSendJob(
  data: CampaignSendJobData,
): Promise<void> {
  const { campaignId, recipientId, baseUrl } = data;

  // 1. Atomic claim: queued -> sending. If 0 rows updated, another worker
  //    already claimed (or terminal-settled) this recipient — no-op.
  const [recipient] = await db
    .update(campaignRecipientsTable)
    .set({ status: "sending" })
    .where(
      and(
        eq(campaignRecipientsTable.id, recipientId),
        eq(campaignRecipientsTable.status, "queued"),
      ),
    )
    .returning();
  if (!recipient) {
    logger.debug(
      { recipientId, campaignId },
      "campaign-send job: recipient already claimed; no-op",
    );
    return;
  }

  // After this point we MUST reach a terminal recipient state, otherwise
  // the row is stuck in `sending` and pg-boss retries no-op (the claim
  // requires status='queued'). Architect-flagged. Wrap the entire
  // post-claim body in try/catch and settle as `failed` on any throw.
  try {
    await runClaimedJob({ campaignId, recipientId, baseUrl, recipient });
  } catch (err) {
    logger.error(
      { err, campaignId, recipientId },
      "campaign-send worker threw post-claim; settling recipient as failed",
    );
    try {
      await settleRecipient({
        recipientId,
        campaignId,
        status: "failed",
        reason: "worker_exception",
        channelUsed: "",
        engagementId: null,
      });
    } catch (settleErr) {
      logger.error(
        { err: settleErr, campaignId, recipientId },
        "failed to terminal-settle recipient after worker exception; row may be stuck in 'sending'",
      );
    }
    // Do NOT rethrow — pg-boss retry would no-op (claim requires
    // status='queued'). The recipient is now `failed`; caller-side
    // metrics already incremented via settleRecipient.
  }
}

async function runClaimedJob(args: {
  campaignId: string;
  recipientId: string;
  baseUrl: string;
  recipient: typeof campaignRecipientsTable.$inferSelect;
}): Promise<void> {
  const { campaignId, recipientId, baseUrl, recipient } = args;

  // 2. Load campaign. If the campaign has been cancelled out-of-band
  //    (currently no UI for this; future pause/resume in 6D-3B will use
  //    `status='cancelled'`), short-circuit to skipped.
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId))
    .limit(1);
  if (!campaign || campaign.status === "cancelled") {
    await settleRecipient({
      recipientId,
      campaignId,
      status: "skipped",
      reason: "campaign_cancelled",
      channelUsed: "",
      engagementId: null,
    });
    return;
  }

  // 3. Load lead.
  const [lead] = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, recipient.leadId))
    .limit(1);
  if (!lead) {
    await settleRecipient({
      recipientId,
      campaignId,
      status: "skipped",
      reason: "lead_not_found",
      channelUsed: "",
      engagementId: null,
    });
    return;
  }

  const channelEnum: "email" | "whatsapp" =
    campaign.channel === "whatsapp" ? "whatsapp" : "email";
  const contact = channelEnum === "whatsapp" ? lead.whatsapp : lead.email;
  const canonical = canonicalContact(channelEnum, contact);

  // 4. No-recipient skip.
  if (!canonical) {
    await settleRecipient({
      recipientId,
      campaignId,
      status: "skipped",
      reason: "no_recipient",
      channelUsed: channelEnum,
      engagementId: null,
    });
    return;
  }

  // 5. Per-recipient unsubscribe check. Moved from the route's pre-loop
  //    snapshot into the worker because async dispatch may run minutes
  //    after enqueue and the lead may have unsubscribed in between
  //    (e.g. clicked the footer of a previous campaign mid-send).
  const unsub = await findUnsubscribed(channelEnum, [canonical]);
  if (unsub.has(canonical)) {
    await settleRecipient({
      recipientId,
      campaignId,
      status: "unsubscribed",
      reason: "unsubscribed",
      channelUsed: channelEnum,
      engagementId: null,
    });
    return;
  }

  // 6. Render body + subject. Sanitiser on email channel only — WA bodies
  //    are plain text.
  const ctx = leadToContext(lead);
  const renderedBodyRaw = renderTemplate(campaign.templateBody ?? "", ctx);
  const renderedBody =
    channelEnum === "email"
      ? sanitizeEmailHtml(renderedBodyRaw)
      : renderedBodyRaw;
  const renderedSubject = renderTemplate(
    campaign.templateSubject ?? "Update from E-Migration Assist",
    ctx,
  );

  let outboundBody = renderedBody;
  if (channelEnum === "email" && baseUrl) {
    const unsubUrl = buildUnsubscribeUrl(baseUrl, "email", canonical);
    outboundBody = `${renderedBody}\n\n—\nDon't want these emails? Unsubscribe: ${unsubUrl}`;
  }

  // 7. Engagement row — written BEFORE dispatch so a crash mid-send leaves
  //    a forensic 'pending' row.
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

  // 8. Dispatch.
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
      else if (decision.mode === "template") channelUsed = "whatsapp_template";
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

  // 9. Persist terminal state on engagement + recipient.
  if (engagement) {
    await db
      .update(leadEngagementsTable)
      .set({ status: ok ? "sent" : "failed" })
      .where(eq(leadEngagementsTable.id, engagement.id));
  }
  await settleRecipient({
    recipientId,
    campaignId,
    status: ok ? "sent" : "failed",
    reason,
    channelUsed,
    engagementId: engagement?.id ?? null,
  });
}
