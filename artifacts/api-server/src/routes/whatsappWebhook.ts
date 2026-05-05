import { Router, type IRouter } from "express";
import type { Logger } from "pino";
import {
  db,
  prelaunchLeadsTable,
  caseMessagesTable,
  analyticsEventsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  verifyTwilioSignature,
  extractInboundMessage,
  detectIntent,
  type ParsedInboundMessage,
} from "../lib/whatsappWebhook";
import { normalizeWhatsapp } from "../lib/whatsapp";

const router: IRouter = Router();

/**
 * POST /api/webhooks/whatsapp
 *
 * Inbound WhatsApp messages from Twilio. Configure in Twilio Console →
 * Messaging → Settings → WhatsApp Sandbox (or your registered sender):
 *   "When a message comes in"  →  https://<your-domain>/api/webhooks/whatsapp
 *   Method                     →  HTTP POST
 *
 * Twilio does NOT use a GET verification handshake — it just starts
 * POSTing once the URL is saved. There is no equivalent of Meta's
 * `hub.challenge`.
 *
 * Critical operational rules:
 *
 *  1. **ALWAYS respond 200.** Twilio retries non-2xx with backoff; an
 *     app-level bug would drown the API in retries. We ack first, then
 *     process. Any error during processing is logged but never bubbled.
 *     We respond with an empty TwiML `<Response/>` so Twilio also
 *     understands "do not auto-reply on my behalf".
 *
 *  2. **Verify signature using Twilio's official helper.** The signature
 *     scheme is `X-Twilio-Signature` = base64(HMAC-SHA1(URL +
 *     sortedConcat(key,value), authToken)). We delegate to the official
 *     SDK rather than reimplement. Failure → log + drop, still 200.
 *
 *  3. **Reconstruct the URL Twilio signed.** Behind Replit's reverse
 *     proxy, `req.protocol` may be `http`. Twilio always calls our
 *     public HTTPS URL, so we force `https://` and use the
 *     `X-Forwarded-Host` header (or `Host` fallback) for the host.
 *
 *  4. **Idempotent storage.** Twilio may deliver the same message twice
 *     (network blip, retry). The `case_messages.wa_message_id` UNIQUE
 *     constraint + ON CONFLICT DO NOTHING ensures the same MessageSid
 *     is never stored twice.
 *
 *  5. **No PII in logs.** Phone digits and message bodies never logged
 *     — only the MessageSid (opaque) and the leadId.
 */
router.post("/webhooks/whatsapp", async (req, res) => {
  // Empty TwiML response — 200 + "do not auto-reply".
  const ack = () =>
    res
      .status(200)
      .set("Content-Type", "text/xml")
      .send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");

  try {
    const authToken = (process.env["TWILIO_AUTH_TOKEN"] ?? "").trim();
    if (!authToken) {
      req.log.error(
        "TWILIO_AUTH_TOKEN env var is not set; dropping webhook event " +
          "(cannot verify authenticity)",
      );
      return ack();
    }

    // Reconstruct the URL Twilio signed. `originalUrl` includes the
    // mounted `/api` prefix and any query string.
    const forwardedHost = req.header("x-forwarded-host");
    const host =
      typeof forwardedHost === "string" && forwardedHost.length > 0
        ? forwardedHost.split(",")[0]?.trim()
        : req.header("host");
    if (!host) {
      req.log.error("No Host header on webhook request; cannot verify");
      return ack();
    }
    const url = `https://${host}${req.originalUrl}`;

    const sig = req.header("x-twilio-signature");
    const params: Record<string, string> = {};
    if (req.body && typeof req.body === "object") {
      for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
        if (typeof v === "string") params[k] = v;
      }
    }

    const ok = verifyTwilioSignature({
      signatureHeader: sig,
      authToken,
      url,
      params,
    });
    if (!ok) {
      req.log.warn(
        { ip: req.ip },
        "Twilio webhook signature verification failed — dropping event",
      );
      return ack();
    }

    const msg = extractInboundMessage(params);
    if (!msg) {
      // Status callbacks, non-text MMS, or unparseable payloads — Twilio
      // still gets a 200.
      return ack();
    }

    // Fire-and-forget so a slow DB never delays the ack to Twilio.
    void handleInboundMessage(msg, req.log).catch((err) =>
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Inbound WhatsApp processing error (silent)",
      ),
    );

    return ack();
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Webhook handler outer error (acked)",
    );
    return res
      .status(200)
      .set("Content-Type", "text/xml")
      .send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
  }
});

/**
 * Match a parsed inbound message to a lead, store it idempotently, run
 * keyword detection, and (if a completion signal fired) hand off to the
 * task reconciliation stub.
 */
async function handleInboundMessage(
  msg: ParsedInboundMessage,
  log: Logger,
): Promise<void> {
  // Twilio gives us "+E164" already (after we stripped the whatsapp:
  // prefix in extractInboundMessage). normalizeWhatsapp is the same
  // canonicaliser used at lead-submission time → guarantees a match if
  // the lead exists.
  const normalized = normalizeWhatsapp(msg.from);
  if (!normalized) {
    log.info(
      { waMessageId: msg.id },
      "Inbound WhatsApp from unparseable number — discarding",
    );
    return;
  }

  // Most-recent lead wins if there are multiple matches (defensive — the
  // dedup branch in POST /api/leads should prevent this in practice).
  const leads = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.whatsapp, normalized))
    .orderBy(desc(prelaunchLeadsTable.createdAt))
    .limit(1);
  const lead = leads[0];

  if (!lead) {
    log.info(
      { waMessageId: msg.id },
      "Inbound WhatsApp from unknown number — no matching lead, dropping",
    );
    return;
  }

  const { intent, matchedKeyword } = detectIntent(msg.body);

  // Idempotent store: if Twilio retries the same MessageSid, ON CONFLICT
  // DO NOTHING returns no row and we skip the downstream side effects.
  const inserted = await db
    .insert(caseMessagesTable)
    .values({
      leadId: lead.id,
      direction: "inbound",
      waMessageId: msg.id,
      message: msg.body,
      intent,
      matchedKeyword,
    })
    .onConflictDoNothing({ target: caseMessagesTable.waMessageId })
    .returning({ id: caseMessagesTable.id });

  if (inserted.length === 0) {
    log.info(
      { waMessageId: msg.id, leadId: lead.id },
      "Inbound WhatsApp duplicate (Twilio retry) — already stored",
    );
    return;
  }

  log.info(
    { leadId: lead.id, waMessageId: msg.id, intent, matchedKeyword },
    "Inbound WhatsApp stored",
  );

  await db
    .insert(analyticsEventsTable)
    .values({
      eventName: "whatsapp_inbound_received",
      leadId: lead.id,
      referenceNumber: lead.referenceNumber,
      payload: {
        intent,
        matchedKeyword,
        hasIntent: intent !== null,
      },
    })
    .catch((err) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to record inbound WhatsApp analytics event",
      ),
    );

  if (intent === "task_complete_signal") {
    await reconcileNextActionsForCase(lead.id, log).catch((err) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "reconcileNextActionsForCase threw (silent)",
      ),
    );
  }
}

/**
 * STUB — task reconciliation hook.
 *
 * Spec calls for "after marking task complete → run
 * reconcileNextActionsForCase()". This codebase does NOT yet have a
 * tasks / next-actions data model, so the actual mutation cannot run.
 *
 * What this stub guarantees today:
 *   * the inbound message is already stored with intent='task_complete_signal'
 *     and the matched keyword — that's the durable record of the user's
 *     signal,
 *   * an info-level log line is emitted so operators see the signal in
 *     the live console / log explorer,
 *   * the function is async-safe and never throws.
 *
 * When the task model is added (next phase), drop the table-scan +
 * UPDATE here. The keyword detection above does not need to change.
 */
async function reconcileNextActionsForCase(
  leadId: string,
  log: Logger,
): Promise<void> {
  log.info(
    { leadId },
    "Inbound completion signal received — task reconciliation deferred " +
      "(no task model in this codebase yet)",
  );
}

export default router;
