import { logger } from "./logger";

/**
 * WhatsApp Business Cloud API (Meta Graph) client.
 *
 * Design rules for this module — DO NOT relax without a corresponding update
 * to `lib/messaging.ts` and the engagement-row lifecycle:
 *
 *  1. **Lazy config read.** `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TOKEN`
 *     are read from `process.env` on EVERY call, never cached at module
 *     load. The Replit secrets pane restarts the workflow when secrets are
 *     added, but the lazy pattern also means a future hot-reload / runtime
 *     secret rotation will be picked up without a code change.
 *
 *  2. **Never throws.** Every error path (network, timeout, 4xx, 5xx,
 *     malformed JSON) returns a `{ ok: false, reason, transient }` shape.
 *     Callers (the `sendMessage()` gateway) translate `transient` into
 *     engagement-row `pending` (retryable) vs `failed` (permanent).
 *
 *  3. **No PII in logs.** The recipient phone number, the message body,
 *     and the bearer token are NEVER logged. Only HTTP status, Meta error
 *     code/type, and a short reason string make it into the structured
 *     log payload.
 *
 *  4. **Recipient format.** Meta expects E.164 *without* a leading `+`.
 *     We strip it once here so callers can pass either form.
 *
 *  5. **Send window.** Meta only allows arbitrary text outside the 24-hour
 *     customer-service window if a pre-approved Message Template is used.
 *     For now we only send free-form text — fine for replies inside the
 *     24h window after a lead submits. Adding template support is a
 *     future-only change to this file.
 */

const GRAPH_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 10_000;

export type WhatsAppSendResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; transient: boolean };

interface WhatsAppConfig {
  phoneNumberId: string;
  token: string;
}

function readConfig(): WhatsAppConfig | null {
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const token = (process.env.WHATSAPP_TOKEN ?? "").trim();
  if (!phoneNumberId || !token) return null;
  return { phoneNumberId, token };
}

export function isWhatsAppConfigured(): boolean {
  return readConfig() !== null;
}

interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
  messages?: { id?: string }[];
}

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

  // Strip leading "+" (Meta wants raw digits) and validate.
  const to = args.to.startsWith("+") ? args.to.slice(1) : args.to;
  if (!/^\d{10,15}$/.test(to)) {
    return { ok: false, reason: "invalid_recipient", transient: false };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    cfg.phoneNumberId,
  )}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: args.message },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Network error, DNS failure, or AbortError on timeout — all transient.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "WhatsApp request failed before response (transient)",
    );
    return {
      ok: false,
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "timeout"
          : "network_error",
      transient: true,
    };
  }

  let body: MetaErrorBody | null = null;
  try {
    body = (await res.json()) as MetaErrorBody;
  } catch {
    // Non-JSON response — treat as transient on 5xx, permanent otherwise.
    body = null;
  }

  if (res.ok) {
    const id = body?.messages?.[0]?.id ?? "";
    return { ok: true, id };
  }

  // 5xx and 429 → transient (retryable); everything else (auth errors,
  // bad recipient, template issues, etc.) → permanent.
  const transient = res.status >= 500 || res.status === 429;

  // Distinguish auth-style errors so the operator UI can give actionable
  // remediation. Meta uses the same shape for several distinct problems:
  //   - code 190           → expired / revoked / malformed token
  //   - code 10            → app lacks the required capability
  //   - code 200           → user/app doesn't have a permission scope
  //                          (subcode 33 in particular = permission missing)
  // The sender app MUST have the `whatsapp_business_messaging` permission
  // (per the Meta Cloud API setup); we surface that as its own reason so
  // the UI doesn't conflate "wrong token" with "right token, missing
  // scope" — they need different fixes.
  const errCode = body?.error?.code;
  const errSubcode = body?.error?.error_subcode;
  let reason: string;
  if (
    errCode === 10 ||
    errCode === 200 ||
    (res.status === 403 && errSubcode === 33)
  ) {
    reason = "missing_permission";
  } else if (
    res.status === 401 ||
    res.status === 403 ||
    errCode === 190
  ) {
    reason = "invalid_credentials";
  } else {
    reason = body?.error?.message ?? `http_${res.status}`;
  }

  logger.warn(
    {
      status: res.status,
      metaErrorCode: body?.error?.code,
      metaErrorType: body?.error?.type,
      metaErrorSubcode: body?.error?.error_subcode,
      transient,
    },
    "WhatsApp send returned error",
  );

  return { ok: false, reason, transient };
}
