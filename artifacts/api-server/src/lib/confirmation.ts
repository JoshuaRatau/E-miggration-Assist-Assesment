import type { Logger } from "pino";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  prelaunchLeadsTable,
  leadEngagementsTable,
  analyticsEventsTable,
} from "@workspace/db";
import { composeConfirmationBody, sendConfirmationEmail } from "./email";
import { sendMessage } from "./messaging";

/**
 * Shared "send the welcome confirmation" pipeline.
 *
 * Originally lived inline in routes/leads.ts (only the assessment flow needed
 * it). CRM Phase B added bulk-import lead creation; rather than duplicate the
 * channel-pick / cooldown / engagement-row / analytics dance there, the entire
 * dispatcher was extracted here so both call sites — `routes/leads.ts` and
 * `lib/imports/commit.ts` — share one source of truth.
 *
 * The dispatcher takes a `Logger` (not a `Request`) so it works in non-HTTP
 * contexts (e.g. inside a per-row commit loop where each iteration logs to a
 * job-scoped child logger).
 *
 * Channel-pick rules (unchanged from V2):
 *   1. If lead opted into WhatsApp AND has a WA number → WhatsApp.
 *   2. Else if lead has an email → email.
 *   3. Else if lead has a WA number → WhatsApp.
 *   4. Otherwise → no-op (silently).
 *
 * Cooldown: when `cooldownMinutes > 0`, we look up the most recent
 * `lead_engagements` row of type='confirmation' with status='sent' for the
 * picked channel. If one exists within the cooldown window, we skip the send
 * entirely — this is the resubmission-spam guard, and is the reason the
 * unauthenticated POST /leads/:id/finalize endpoint can be at-most-once-ish.
 */
export function buildConfirmationDispatcher(deps: { log: Logger }) {
  const { log } = deps;
  return function dispatchConfirmation(
    lead: typeof prelaunchLeadsTable.$inferSelect,
    cooldownMinutes: number,
  ): void {
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
            log.info(
              { leadId, channel, cooldownMinutes },
              "Skipping resubmission confirmation (recent send within cooldown)",
            );
            return;
          }
        } catch (err) {
          log.warn(
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
        log.warn({ err }, "Failed to record confirmation engagement row");
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
              log.warn(
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
        log.warn({ err }, "Confirmation pipeline error (silent)");
      }
    })();
  };
}
