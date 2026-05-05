import { Router, type IRouter, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Logger } from "pino";
import {
  db,
  prelaunchLeadsTable,
  caseMessagesTable,
  analyticsEventsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  verifyMetaSignature,
  extractInboundMessages,
  detectIntent,
  type ParsedInboundMessage,
} from "../lib/whatsappWebhook";
import { normalizeWhatsapp } from "../lib/whatsapp";

const router: IRouter = Router();

/**
 * GET /api/webhooks/whatsapp
 *
 * Meta verification handshake. When you configure (or rotate) the webhook
 * subscription in the Meta App Dashboard, Meta hits this URL with:
 *   ?hub.mode=subscribe
 *   &hub.verify_token=<the token YOU set in the dashboard>
 *   &hub.challenge=<random string>
 *
 * We compare the supplied token against `WHATSAPP_VERIFY_TOKEN` in
 * constant time and echo back the challenge VERBATIM AS PLAIN TEXT on
 * match, or 403 on mismatch. Meta will not activate the subscription
 * without a successful handshake.
 */
router.get("/webhooks/whatsapp", (req, res) => {
  const expected = (process.env["WHATSAPP_VERIFY_TOKEN"] ?? "").trim();
  if (!expected) {
    req.log.error(
      "WHATSAPP_VERIFY_TOKEN env var is not set; refusing handshake",
    );
    return res.status(503).end();
  }

  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode !== "subscribe") {
    return res.status(403).end();
  }

  const ab = Buffer.from(token);
  const bb = Buffer.from(expected);
  if (ab.length !== bb.length || !timingSafeEqual(ab, bb)) {
    req.log.warn(
      { ip: req.ip },
      "WhatsApp webhook handshake rejected — bad verify token",
    );
    return res.status(403).end();
  }

  return res.status(200).type("text/plain").send(challenge);
});

/**
 * POST /api/webhooks/whatsapp
 *
 * Receive inbound messages and status callbacks from Meta.
 *
 * Critical operational rules:
 *
 *  1. **ALWAYS respond 200.** Meta retries non-2xx responses with
 *     exponential backoff for up to 24 hours; that means an app-level bug
 *     would drown the API in retries. We ack first, then process. Errors
 *     during processing are logged but never bubbled.
 *
 *  2. **Verify signature against the RAW body.** The body has to be
 *     compared byte-for-byte to Meta's HMAC. `app.ts` captures the raw
 *     buffer via `express.json({ verify })`; if it's missing we drop the
 *     event with an error log (still 200ing to Meta).
 *
 *  3. **Idempotent storage.** Meta may deliver the same message twice
 *     (cross-region failover, retry on prior 5xx, etc). The
 *     `case_messages.wa_message_id` UNIQUE constraint + ON CONFLICT DO
 *     NOTHING ensures the same wamid is never stored twice.
 *
 *  4. **Fire-and-forget per message.** Each parsed message is processed
 *     independently so a DB error on one doesn't prevent storing the
 *     others in the same batch.
 *
 *  5. **No PII in logs.** Phone number digits and message bodies are
 *     never logged — only the wamid (an opaque Meta id) and the leadId.
 */
router.post("/webhooks/whatsapp", async (req, res) => {
  // Ack helper: Meta MUST get a 200 from us regardless of internal state.
  const ack = () => res.status(200).end();

  try {
    const appSecret = (process.env["WHATSAPP_APP_SECRET"] ?? "").trim();
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!appSecret) {
      req.log.error(
        "WHATSAPP_APP_SECRET env var is not set; dropping webhook event " +
          "(cannot verify authenticity)",
      );
      return ack();
    }
    if (!rawBody) {
      req.log.error(
        "Raw request body is missing; cannot verify Meta signature " +
          "(check express.json `verify` callback in app.ts)",
      );
      return ack();
    }

    const sig = req.header("x-hub-signature-256");
    const ok = verifyMetaSignature({
      signatureHeader: sig,
      appSecret,
      rawBody,
    });
    if (!ok) {
      req.log.warn(
        { ip: req.ip },
        "WhatsApp webhook signature verification failed — dropping event",
      );
      return ack();
    }

    const messages = extractInboundMessages(req.body);
    if (messages.length === 0) {
      // Status callbacks (delivered/read receipts) and non-text message
      // types land here. Nothing to do — Meta still gets a 200.
      return ack();
    }

    // Process each message independently so a single failure doesn't
    // cascade. We don't await — handler errors are caught inside.
    for (const msg of messages) {
      void handleInboundMessage(msg, req.log).catch((err) =>
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "Inbound WhatsApp processing error (silent)",
        ),
      );
    }

    return ack();
  } catch (err) {
    req.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Webhook handler outer error (acked)",
    );
    return res.status(200).end();
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
  // Meta sends `from` as digits-only (no `+`). Re-add the prefix so it
  // round-trips through our canonical normalizer (which is the same one
  // used when leads are stored — guarantees a match if the lead exists).
  const candidate = msg.from.startsWith("+") ? msg.from : `+${msg.from}`;
  const normalized = normalizeWhatsapp(candidate);
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

  // Idempotent store: if Meta retries the same wamid, ON CONFLICT DO
  // NOTHING returns no row and we skip the downstream side effects.
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
      "Inbound WhatsApp duplicate (Meta retry) — already stored",
    );
    return;
  }

  log.info(
    { leadId: lead.id, waMessageId: msg.id, intent, matchedKeyword },
    "Inbound WhatsApp stored",
  );

  // Analytics — never blocks downstream processing.
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
 * Spec calls for: "after marking task complete → run
 * reconcileNextActionsForCase()". This codebase does NOT yet have a
 * tasks / next-actions data model, so the actual mutation cannot run.
 *
 * What this stub guarantees today:
 *   * the inbound message is already stored with intent='task_complete_signal'
 *     and the matched keyword — that's the durable record of the user's signal,
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
