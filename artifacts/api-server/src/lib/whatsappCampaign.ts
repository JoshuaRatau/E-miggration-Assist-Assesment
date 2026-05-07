import { db, caseMessagesTable } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import { normalizeWhatsapp } from "./whatsapp";
import { sendWhatsAppText } from "./whatsappClient";

// Phase 4 — WhatsApp campaign sender.
//
// The Twilio / Meta WhatsApp Business API enforces a hard rule:
//   * Inside the 24-hour customer-service window (i.e. the contact has
//     messaged us in the last 24h) we may send free-form text.
//   * Outside that window, only pre-approved Message Templates may be sent.
//
// This module decides which path applies for a given lead and dispatches
// accordingly. The campaign editor exposes both: the operator picks a
// pre-approved template SID for cold outreach AND writes a free-form body
// that's used when the in-window path is available. If neither is possible
// (no template SID, contact is out of window) the recipient is SKIPPED with
// reason `wa_out_of_window_no_template`.

export const WA_24H_MS = 24 * 60 * 60 * 1000;

export type WaSendDecision =
  | { mode: "freeform"; body: string }
  | { mode: "template"; templateSid: string }
  | { mode: "skip"; reason: string };

/**
 * Has the lead messaged us within the last 24 hours? `lead_engagements`
 * stores OUTBOUND only; INBOUND lives in `case_messages` (despite the name —
 * see the schema comment in leads.ts:158). We query the latter for the most
 * recent inbound and compare to NOW.
 */
export async function isInWhatsAppWindow(leadId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - WA_24H_MS);
  const rows = await db
    .select({ id: caseMessagesTable.id })
    .from(caseMessagesTable)
    .where(
      and(
        eq(caseMessagesTable.leadId, leadId),
        eq(caseMessagesTable.direction, "inbound"),
        gt(caseMessagesTable.createdAt, cutoff),
      ),
    )
    .orderBy(desc(caseMessagesTable.createdAt))
    .limit(1);
  return rows.length > 0;
}

export async function decideWaSend(args: {
  leadId: string;
  whatsapp: string | null;
  templateSid: string | null;
  freeformBody: string | null;
}): Promise<WaSendDecision> {
  const normalized = normalizeWhatsapp(args.whatsapp ?? "");
  if (!normalized) return { mode: "skip", reason: "no_recipient" };

  const inWindow = await isInWhatsAppWindow(args.leadId);
  if (inWindow) {
    const body = (args.freeformBody ?? "").trim();
    if (body.length === 0) {
      // We're in window but the operator didn't write a free-form body —
      // fall through to template if there is one. Otherwise skip.
      if (args.templateSid) {
        return { mode: "template", templateSid: args.templateSid };
      }
      return { mode: "skip", reason: "wa_no_body_or_template" };
    }
    return { mode: "freeform", body };
  }

  // Out of window: template is the ONLY compliant option.
  if (args.templateSid) {
    return { mode: "template", templateSid: args.templateSid };
  }
  return { mode: "skip", reason: "wa_out_of_window_no_template" };
}

/**
 * Execute a decision. Free-form goes through the existing text sender;
 * templates would route to the Twilio Content API. We DON'T silently send
 * a free-form text in place of a template — that's the entire compliance
 * boundary this module exists to enforce.
 */
export async function executeWaDecision(args: {
  to: string;
  decision: WaSendDecision;
}): Promise<{ ok: true; id?: string; channelUsed: string } | { ok: false; reason: string; transient?: boolean }> {
  if (args.decision.mode === "skip") {
    return { ok: false, reason: args.decision.reason };
  }
  if (args.decision.mode === "freeform") {
    const r = await sendWhatsAppText({ to: args.to, message: args.decision.body });
    if (r.ok) return { ok: true, id: r.id, channelUsed: "whatsapp_freeform" };
    return { ok: false, reason: r.reason, transient: r.transient };
  }
  // template path — Twilio's Content API requires a Content SID. We don't
  // have a typed wrapper yet; the existing `sendWhatsAppText` only handles
  // free-form sessions. For V1, return a clear "not_implemented" so the
  // recipient row is marked failed with an actionable reason rather than
  // silently mis-sending. Wiring the Content SID call is a small follow-up
  // (Twilio.messages.create with `contentSid` instead of `body`).
  return {
    ok: false,
    reason: "wa_template_send_not_implemented",
    transient: false,
  };
}
