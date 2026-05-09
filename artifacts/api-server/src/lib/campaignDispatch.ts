import { eq, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignRecipientsTable,
  prelaunchLeadsTable,
  type Campaign,
  type PrelaunchLead,
} from "@workspace/db";
import type { Logger } from "pino";
import { compileAudience, type AudienceQuery } from "./audienceQuery";
import { findUnknownTokens } from "./campaignRender";
import { findUnsubscribed, canonicalContact } from "./unsubscribe";
import { enqueueCampaignSends } from "./queue";

// Phase 6D-3B — shared dispatch path.
//
// Both the synchronous send route (POST /:id/send) and the scheduled-send
// worker (lib/campaignScheduleWorker.ts) need to perform identical work:
// audience compile → snapshot → materialise recipients → pre-settle
// suppressions → enqueue jobs. The only difference is who CLAIMED the
// campaign (operator click vs. scheduler tick) and how the result is
// surfaced (HTTP response vs. log line).
//
// This module owns everything *after* the claim. Callers must:
//   1. Atomically transition the campaign into 'sending' status
//      themselves (so concurrent claims 409 cleanly).
//   2. Pass the resulting freshly-claimed campaign row in.
//   3. Handle their own audit-log writes around the call.
//
// The helper handles its own revert-to-draft on early-exit conditions
// (empty audience, over cap, missing template body, etc.), so callers
// must NOT also try to revert. On materialise/enqueue failure it flips
// the campaign to 'cancelled' (terminal — never stuck in 'sending').

export const MAX_RECIPIENTS_PER_CAMPAIGN = 2000;

export type DispatchOutcome =
  | {
      ok: true;
      campaign: Campaign;
      queued: number;
      preSettled: { skipped: number; unsub: number };
    }
  | {
      ok: false;
      // HTTP-style status so the route can mirror it directly.
      status: 400 | 413 | 500;
      reason: string;
      message: string;
      campaign: Campaign | null;
      // Set when the helper terminal-cancelled the campaign (vs. reverted
      // to draft). Lets the caller surface the cancelled row to the user.
      cancelled?: boolean;
    };

interface DispatchArgs {
  campaign: Campaign;
  log: Logger;
}

export async function dispatchClaimedCampaign(
  args: DispatchArgs,
): Promise<DispatchOutcome> {
  const { campaign, log } = args;
  const id = campaign.id;

  const revertToDraft = async (reason: string): Promise<Campaign | null> => {
    const [reverted] = await db
      .update(campaignsTable)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(campaignsTable.id, id))
      .returning();
    log.info({ campaignId: id, reason }, "Reverted campaign to draft");
    return reverted ?? null;
  };

  const filter = (campaign.audienceFilter ?? null) as AudienceQuery | null;
  if (!filter || filter.rules.length === 0) {
    const reverted = await revertToDraft("empty_filter");
    return {
      ok: false,
      status: 400,
      reason: "empty_filter",
      message: "Campaign has no audience filter configured",
      campaign: reverted,
    };
  }

  const channelEnum: "email" | "whatsapp" =
    campaign.channel === "whatsapp" ? "whatsapp" : "email";

  const body = (campaign.templateBody ?? "").trim();
  if (channelEnum === "email") {
    if (body.length === 0) {
      const reverted = await revertToDraft("empty_body");
      return {
        ok: false,
        status: 400,
        reason: "empty_body",
        message: "Email campaigns require a template body",
        campaign: reverted,
      };
    }
    if (findUnknownTokens(body).length > 0) {
      const reverted = await revertToDraft("unknown_tokens");
      return {
        ok: false,
        status: 400,
        reason: "unknown_tokens",
        message: "Template body contains unknown merge tokens",
        campaign: reverted,
      };
    }
  }

  const where = compileAudience(filter);
  if (!where) {
    const reverted = await revertToDraft("compile_failed");
    return {
      ok: false,
      status: 500,
      reason: "compile_failed",
      message: "Failed to compile audience filter",
      campaign: reverted,
    };
  }

  let audience: PrelaunchLead[];
  try {
    audience = await db.select().from(prelaunchLeadsTable).where(where);
  } catch (err) {
    log.error({ err, campaignId: id }, "Audience query failed");
    const reverted = await revertToDraft("query_failed");
    return {
      ok: false,
      status: 500,
      reason: "query_failed",
      message: "Failed to load audience",
      campaign: reverted,
    };
  }

  if (audience.length === 0) {
    const reverted = await revertToDraft("empty_audience");
    return {
      ok: false,
      status: 400,
      reason: "empty_audience",
      message: "Audience filter matched zero leads",
      campaign: reverted,
    };
  }
  if (audience.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
    const reverted = await revertToDraft("over_cap");
    return {
      ok: false,
      status: 413,
      reason: "over_cap",
      message: `Audience of ${audience.length} exceeds the ${MAX_RECIPIENTS_PER_CAMPAIGN}-recipient cap. Tighten the filter and try again.`,
      campaign: reverted,
    };
  }

  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "");
  if (channelEnum === "email" && !baseUrl) {
    const reverted = await revertToDraft("missing_base_url");
    return {
      ok: false,
      status: 500,
      reason: "missing_base_url",
      message:
        "Email campaigns require PUBLIC_BASE_URL (or REPLIT_DEV_DOMAIN) so the unsubscribe link can be built. Refusing to send without it.",
      campaign: reverted,
    };
  }

  const contactsForChannel = audience
    .map((l) => (channelEnum === "whatsapp" ? l.whatsapp : l.email))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const unsubSet = await findUnsubscribed(channelEnum, contactsForChannel);

  // Snapshot count BEFORE materialising so the campaign row reflects
  // the audience size even if recipient inserts fail mid-way.
  await db
    .update(campaignsTable)
    .set({
      audienceSnapshotCount: audience.length,
      recipientsTotal: audience.length,
      updatedAt: new Date(),
    })
    .where(eq(campaignsTable.id, id));

  // Materialise recipient rows + pre-settle suppressions.
  const recipientIds: string[] = [];
  const preCounted = { skipped: 0, unsub: 0 };
  let runtimeError: unknown = null;
  try {
    for (const lead of audience) {
      const contact =
        channelEnum === "whatsapp" ? lead.whatsapp : lead.email;
      const canonical = canonicalContact(channelEnum, contact);

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
      if (!recipient) continue; // already tracked (defensive)

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

      recipientIds.push(recipient.id);
    }
  } catch (err) {
    runtimeError = err;
    log.error({ err, campaignId: id }, "Recipient materialisation failed");
  }

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
    const [final] = await db
      .update(campaignsTable)
      .set({
        status: "cancelled",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, id))
      .returning();
    return {
      ok: false,
      status: 500,
      reason: "materialisation_failed",
      message: "Campaign send aborted; marked cancelled.",
      campaign: final ?? null,
      cancelled: true,
    };
  }

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
      log.error(
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
      return {
        ok: false,
        status: 500,
        reason: "enqueue_failed",
        message: "Failed to enqueue send jobs; campaign marked cancelled.",
        campaign: final ?? null,
        cancelled: true,
      };
    }
  } else if (preCounted.skipped + preCounted.unsub === audience.length) {
    // Every recipient was pre-settled — finalise immediately.
    await db
      .update(campaignsTable)
      .set({
        status: "completed",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignsTable.id, id));
  }

  // Read back with the freshly-flushed counters.
  const [campaignAfter] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id))
    .limit(1);

  return {
    ok: true,
    campaign: campaignAfter ?? campaign,
    queued: recipientIds.length,
    preSettled: preCounted,
  };
}
