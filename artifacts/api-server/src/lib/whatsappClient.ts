import { logger } from "./logger";
import twilio from "twilio";

/**
 * WhatsApp client — Twilio Programmable Messaging.
 *
 * Switched from Meta WhatsApp Business Cloud API to Twilio. The function
 * signature (`sendWhatsAppText`) and result shape (`WhatsAppSendResult`)
 * are deliberately unchanged so `lib/messaging.ts` and the engagement
 * lifecycle continue to work without edits.
 *
 * Module rules — DO NOT relax without a corresponding update to
 * `lib/messaging.ts`:
 *
 *  1. **Lazy config read.** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
 *     `TWILIO_WHATSAPP_FROM` are read on EVERY call. The Replit secrets
 *     pane restarts the workflow on add, but lazy reads also pick up a
 *     future runtime rotation without a code change.
 *
 *  2. **Never throws.** Every error path (network, timeout, 4xx, 5xx,
 *     malformed) returns `{ ok: false, reason, transient }`. Callers
 *     (the `sendMessage()` gateway) translate `transient` into engagement
 *     `pending` (retryable) vs `failed` (permanent).
 *
 *  3. **No PII in logs.** The recipient phone, the message body, and the
 *     auth token are NEVER logged. Only HTTP status, Twilio error code,
 *     and a short reason string make it into the structured payload.
 *
 *  4. **Recipient format.** Twilio expects `whatsapp:+E164` on both From
 *     and To. We accept `+E164`, `E164`, or `whatsapp:+E164` from callers
 *     and normalise once here.
 *
 *  5. **Send window.** Twilio (like Meta) only allows arbitrary text
 *     outside the 24-hour customer-service window if a pre-approved
 *     Content Template is used. Free-form text is fine inside the 24h
 *     window. Adding template support is a future-only change to this file.
 *
 *  6. **Sandbox caveat.** When `TWILIO_WHATSAPP_FROM` is the Twilio
 *     Sandbox number (whatsapp:+14155238886), the recipient must have
 *     first sent "join <sandbox-keyword>" to that number. If they have
 *     not, Twilio returns error code 63007 → reason
 *     `recipient_not_joined_sandbox` (permanent, not retryable).
 */

const REQUEST_TIMEOUT_MS = 10_000;

export type WhatsAppSendResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; transient: boolean };

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromAddress: string; // canonical "whatsapp:+E164"
}

function readConfig(): TwilioConfig | null {
  const accountSid = (process.env["TWILIO_ACCOUNT_SID"] ?? "").trim();
  const authToken = (process.env["TWILIO_AUTH_TOKEN"] ?? "").trim();
  let fromRaw = (process.env["TWILIO_WHATSAPP_FROM"] ?? "").trim();
  if (!accountSid || !authToken || !fromRaw) return null;
  if (!fromRaw.startsWith("whatsapp:")) fromRaw = "whatsapp:" + fromRaw;
  return { accountSid, authToken, fromAddress: fromRaw };
}

export function isWhatsAppConfigured(): boolean {
  return readConfig() !== null;
}

interface TwilioSdkError {
  status?: number;
  code?: number;
  message?: string;
  // Node low-level transport errors expose `code` as a string ("ETIMEDOUT",
  // "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", …). The Twilio SDK error type's
  // `code` is numeric, but the SDK lets transport errors bubble up
  // unwrapped, so a thrown error may carry either shape. We capture both.
  errno?: number;
  syscall?: string;
}

// Node-level transport error codes that indicate a TRANSIENT condition
// (network blip, DNS hiccup, peer reset, server timeout). When the Twilio
// SDK throws one of these the HTTP `status` is undefined / 0 — don't let
// that be silently classified as permanent.
const TRANSIENT_NODE_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

export async function sendWhatsAppText(args: {
  to: string;
  message: string;
}): Promise<WhatsAppSendResult> {
  const cfg = readConfig();
  if (!cfg) {
    // Per spec: missing secrets is a PERMANENT failure ('failed' engagement
    // with reason 'not_configured'), not a transient/pending one. The
    // operator must add the secrets and resend — there is no auto-retry.
    return { ok: false, reason: "not_configured", transient: false };
  }

  // Normalise recipient to canonical "whatsapp:+E164". Accept any of:
  //   "+27739395126"          →  "whatsapp:+27739395126"
  //   "27739395126"           →  "whatsapp:+27739395126"
  //   "whatsapp:+27739..."    →  unchanged (after validation)
  // The shape check ALWAYS runs after stripping any "whatsapp:" prefix so
  // a malformed prefixed value (e.g. "whatsapp:abc") is rejected locally
  // with `invalid_recipient` instead of round-tripping to Twilio.
  let to = args.to;
  const hadPrefix = to.startsWith("whatsapp:");
  let bare = hadPrefix ? to.slice("whatsapp:".length) : to;
  if (!bare.startsWith("+")) bare = "+" + bare;
  if (!/^\+\d{10,15}$/.test(bare)) {
    return { ok: false, reason: "invalid_recipient", transient: false };
  }
  to = "whatsapp:" + bare;

  // The Twilio SDK constructor throws SYNCHRONOUSLY on validation failure
  // (e.g. accountSid not starting with "AC"). Construct INSIDE the try
  // block so those throws are caught here and translated to the same
  // structured `{ ok: false, reason, transient }` shape as everything
  // else — otherwise the messaging gateway sees a raw throw, classifies
  // it as "unexpected → transient", and the engagement gets stuck in
  // `pending` forever instead of surfacing the configuration error to
  // the operator.
  try {
    const client = twilio(cfg.accountSid, cfg.authToken, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const msg = await client.messages.create({
      from: cfg.fromAddress,
      to,
      body: args.message,
    });
    return { ok: true, id: msg.sid };
  } catch (err) {
    const e = err as TwilioSdkError;
    const status = typeof e.status === "number" ? e.status : 0;
    const code = typeof e.code === "number" ? e.code : undefined;
    // Node transport errors stringify `code` (e.g. "ETIMEDOUT"); Twilio API
    // errors number-ify it. Capture the string form separately for transient
    // classification.
    const rawCode = (err as { code?: unknown })?.code;
    const nodeCode = typeof rawCode === "string" ? rawCode : undefined;

    // Detect SDK constructor validation errors first so they don't get
    // mis-classified as transient by the "status===0 && code===undefined"
    // fallback below (they ARE permanent — the secrets are wrong and no
    // amount of retry will fix that).
    const sdkConfigErrMsg = (e.message ?? "").toLowerCase();
    const isSdkConfigError =
      status === 0 &&
      code === undefined &&
      !nodeCode &&
      (sdkConfigErrMsg.includes("accountsid") ||
        sdkConfigErrMsg.includes("authtoken") ||
        sdkConfigErrMsg.includes("must start with"));

    // Transient classification:
    //   - SDK constructor validation (bad SID/token format) → PERMANENT
    //   - HTTP 5xx or 429 from Twilio → transient (server-side retry-friendly)
    //   - Node transport errors (ETIMEDOUT etc.) → transient (no `status`)
    //   - Status absent AND no recognised Node code AND not an SDK config
    //     error → transient by default (we'd rather retry an opaque
    //     transport-layer failure than silently mark a real-but-untyped
    //     network blip as permanent)
    //   - Anything else (4xx with a known Twilio code) → permanent
    let transient: boolean;
    if (isSdkConfigError) {
      transient = false;
    } else if (status >= 500 || status === 429) {
      transient = true;
    } else if (nodeCode && TRANSIENT_NODE_ERROR_CODES.has(nodeCode)) {
      transient = true;
    } else if (status === 0 && code === undefined) {
      transient = true;
    } else {
      transient = false;
    }

    // Map common Twilio error codes to actionable reasons. Full list:
    // https://www.twilio.com/docs/api/errors
    //   20003: authenticate (bad SID / token)
    //   20404: resource not found (often: wrong account scope)
    //   21211: invalid 'To' number
    //   21408: permission to send to this number not enabled
    //   21610: recipient unsubscribed (STOP)
    //   21617: message too long
    //   63007: recipient has not joined the sandbox
    //   63016: outside 24h window — must use approved template
    //   63018: rate limit hit on the WABA
    let reason: string;
    // Twilio SDK constructor validation errors come through as plain
    // Error objects with no `status` / `code`, but their messages are
    // diagnostic. Normalise them to `invalid_credentials` so the operator
    // sees the configuration problem instead of an opaque "internal_error".
    const msgLower = (e.message ?? "").toLowerCase();
    const isSdkConfigValidation =
      status === 0 &&
      code === undefined &&
      !nodeCode &&
      (msgLower.includes("accountsid") ||
        msgLower.includes("authtoken") ||
        msgLower.includes("must start with"));
    if (isSdkConfigValidation) {
      reason = "invalid_credentials";
    } else if (code === 20003 || status === 401 || status === 403) {
      reason = "invalid_credentials";
    } else if (code === 21211 || code === 21408) {
      reason = "invalid_recipient";
    } else if (code === 63007) {
      reason = "recipient_not_joined_sandbox";
    } else if (code === 63016) {
      reason = "outside_session_window";
    } else if (code === 21610) {
      reason = "recipient_unsubscribed";
    } else if (nodeCode && TRANSIENT_NODE_ERROR_CODES.has(nodeCode)) {
      reason = `network_${nodeCode.toLowerCase()}`;
    } else {
      reason = e.message ?? (status > 0 ? `http_${status}` : "unknown_error");
    }

    logger.warn(
      { status, twilioCode: code, nodeCode, transient },
      "Twilio WhatsApp send returned error",
    );

    return { ok: false, reason, transient };
  }
}
