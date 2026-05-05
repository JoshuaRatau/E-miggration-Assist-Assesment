import twilio from "twilio";

/**
 * Inbound WhatsApp webhook helpers — Twilio.
 *
 * Switched from Meta to Twilio. Differences vs. the previous Meta code:
 *
 *   * Twilio sends `application/x-www-form-urlencoded` with FLAT keys
 *     (`From`, `Body`, `MessageSid`, …) — not Meta's nested JSON.
 *   * Twilio's signature scheme is `X-Twilio-Signature`: base64-encoded
 *     HMAC-SHA1 over `URL + sortedConcat(key, value)` using the auth
 *     token as the secret. NOT a raw-body HMAC. We delegate verification
 *     to `twilio.validateRequest` from the official SDK so we don't
 *     reimplement the cipher/encoding correctly only most of the time.
 *   * No GET verification handshake — Twilio doesn't have one.
 *
 * Module rules — DO NOT relax:
 *
 *  1. **Pure functions only.** No DB / no network — those live in the
 *     route handler so this module stays trivially unit-testable.
 *  2. **Defensive parsing.** Twilio may post non-text events (status
 *     callbacks, MMS, system messages). Anything we don't understand
 *     returns null and the route still 200s back to Twilio.
 *  3. **Whole-word keyword matches.** "doneness" must NOT trigger "done";
 *     "presented" must NOT trigger "sent". Word-boundary regex is the
 *     correct Phase-1 approach (no LLM).
 */

/**
 * Verify Twilio's `X-Twilio-Signature` against the request URL + POST
 * params using the official SDK helper.
 *
 * Returns false on any malformed input — never throws.
 */
export function verifyTwilioSignature(args: {
  signatureHeader: string | undefined;
  authToken: string;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!args.signatureHeader || !args.authToken || !args.url) return false;
  try {
    return twilio.validateRequest(
      args.authToken,
      args.signatureHeader,
      args.url,
      args.params,
    );
  } catch {
    return false;
  }
}

export interface ParsedInboundMessage {
  from: string; // canonical "+E164"
  id: string; // Twilio MessageSid
  body: string;
}

/**
 * Pluck an inbound text message from a Twilio webhook form payload.
 *
 * Returns null for:
 *   - missing `From` / `Body` / `MessageSid`
 *   - non-text messages (e.g. MMS — `NumMedia > 0` and no body)
 *   - status callbacks (those use a different URL in our config and
 *     would not normally hit this route anyway, but we belt+brace by
 *     refusing payloads that look like status callbacks).
 *
 * Strips the `whatsapp:` prefix from `From` so downstream lead matching
 * sees a canonical `+E164` string.
 */
export function extractInboundMessage(
  formBody: Record<string, unknown>,
): ParsedInboundMessage | null {
  const fromRaw = typeof formBody["From"] === "string" ? formBody["From"] : "";
  const id =
    typeof formBody["MessageSid"] === "string" ? formBody["MessageSid"] : "";
  const body = typeof formBody["Body"] === "string" ? formBody["Body"] : "";

  if (!fromRaw || !id || !body) return null;

  // Status callbacks include `MessageStatus` and never have a `Body` —
  // the body check above already excludes them, but the explicit guard
  // here makes intent obvious to a future reader.
  if (typeof formBody["MessageStatus"] === "string") return null;

  const from = fromRaw.startsWith("whatsapp:")
    ? fromRaw.slice("whatsapp:".length)
    : fromRaw;

  if (from.length === 0) return null;

  return { from, id, body };
}

/**
 * Phase 1 deterministic intent detection. Whole-word match
 * (case-insensitive) against the completion-signal keyword list. First
 * match wins.
 *
 * Matched messages get `intent='task_complete_signal'`; unmatched
 * messages get `intent=null` and are stored verbatim for the operator
 * to read in the admin timeline (per spec: "if message unclear → log
 * only, no action").
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
