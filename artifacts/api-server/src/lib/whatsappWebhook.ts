import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound WhatsApp webhook helpers.
 *
 * Module rules — DO NOT relax without updating the route handler:
 *
 *  1. **Pure functions only.** No DB or network — those live in the route
 *     handler so this module stays trivially unit-testable.
 *
 *  2. **Defensive parsing.** Meta's payload shape is loosely typed in
 *     practice (status updates and message events share the same envelope,
 *     non-text message types appear, fields can be absent). Every nested
 *     access is null-checked so a malformed payload returns "no messages"
 *     rather than crashing — Meta will retry forever on non-2xx responses.
 *
 *  3. **Whole-word keyword matches.** "doneness" must NOT trigger "done";
 *     "presented" must NOT trigger "sent". Word boundary regex is the
 *     simplest correct approach for Phase 1 (no LLM).
 *
 *  4. **Constant-time signature compare.** HMAC verification uses
 *     `timingSafeEqual` over equal-length buffers; mismatched lengths
 *     short-circuit BEFORE the compare to avoid a TypeError leak.
 */

/**
 * Verify Meta's `X-Hub-Signature-256` against the raw request body.
 *
 * Meta computes `sha256=<hex>` where `<hex>` is HMAC-SHA256 of the *raw*
 * request body (NOT a re-serialized JSON) using the App Secret as the key.
 * Returns false on any malformed input — never throws.
 */
export function verifyMetaSignature(args: {
  signatureHeader: string | undefined;
  appSecret: string;
  rawBody: Buffer;
}): boolean {
  if (!args.signatureHeader || !args.appSecret) return false;
  const prefix = "sha256=";
  if (!args.signatureHeader.startsWith(prefix)) return false;

  const providedHex = args.signatureHeader.slice(prefix.length);
  // Hex must be even-length and only [0-9a-f] — reject anything else.
  if (providedHex.length === 0 || providedHex.length % 2 !== 0) return false;
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;

  const expectedHex = createHmac("sha256", args.appSecret)
    .update(args.rawBody)
    .digest("hex");
  if (providedHex.length !== expectedHex.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(providedHex, "hex"),
      Buffer.from(expectedHex, "hex"),
    );
  } catch {
    return false;
  }
}

interface MetaInboundMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

interface MetaWebhookChange {
  field?: string;
  value?: {
    messages?: MetaInboundMessage[];
    statuses?: unknown[];
  };
}

interface MetaWebhookEntry {
  changes?: MetaWebhookChange[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

export interface ParsedInboundMessage {
  from: string;
  id: string;
  body: string;
}

/**
 * Pluck inbound TEXT messages from a Meta WhatsApp webhook payload.
 *
 * Phase 1 deliberately ignores:
 *   - `statuses[]` (delivery / read receipts for OUTBOUND messages)
 *   - non-text message types (image, audio, location, interactive, …)
 *   - any payload where `object !== "whatsapp_business_account"`
 *
 * Returning [] is the correct outcome for any of those — the webhook
 * handler still 200s back to Meta so it doesn't get put on a retry queue.
 */
export function extractInboundMessages(
  payload: unknown,
): ParsedInboundMessage[] {
  const out: ParsedInboundMessage[] = [];
  if (!payload || typeof payload !== "object") return out;
  const p = payload as MetaWebhookPayload;
  if (p.object !== "whatsapp_business_account") return out;

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const msg of change.value?.messages ?? []) {
        if (msg.type !== "text") continue;
        const body = msg.text?.body;
        if (
          typeof msg.from !== "string" ||
          typeof msg.id !== "string" ||
          typeof body !== "string" ||
          msg.from.length === 0 ||
          msg.id.length === 0 ||
          body.length === 0
        ) {
          continue;
        }
        out.push({ from: msg.from, id: msg.id, body });
      }
    }
  }
  return out;
}

/**
 * Phase 1 deterministic intent detection. Whole-word match (case-insensitive)
 * against the completion-signal keyword list. First match wins.
 *
 * Matched messages get `intent='task_complete_signal'`; unmatched messages
 * get `intent=null` and are stored verbatim for the operator to read in the
 * admin timeline (per spec: "if message unclear → log only (no action)").
 */
const COMPLETION_KEYWORDS = ["done", "uploaded", "sent"] as const;

export function detectIntent(message: string): {
  intent: "task_complete_signal" | null;
  matchedKeyword: string | null;
} {
  for (const kw of COMPLETION_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(message)) {
      return { intent: "task_complete_signal", matchedKeyword: kw };
    }
  }
  return { intent: null, matchedKeyword: null };
}
