import { sendUpdateEmail, type SendResult } from "./email";
import { logger } from "./logger";

export type MessagingChannel = "email" | "whatsapp";

export type MessagingResult =
  | { ok: true; channel: MessagingChannel; id?: string }
  | { ok: false; channel: MessagingChannel; reason: string; pending?: boolean };

export interface SendMessageArgs {
  channel: MessagingChannel;
  to: string | null | undefined;
  message: string;
  subject?: string;
  referenceNumber?: string | null;
}

/**
 * Channel-agnostic outbound message gateway.
 *
 * Contract (called from the lead engagement layer):
 *   - MUST NOT throw. Every error path returns a `{ ok: false, reason }`
 *     shape. Callers therefore never need a try/catch.
 *   - When the underlying provider is not configured (e.g. Resend connection
 *     missing, WhatsApp not yet wired up) the result is `{ ok: false,
 *     pending: true, reason: ... }`. The engagement layer interprets
 *     `pending: true` as "leave the engagement row in `pending` status — do
 *     NOT mark it failed", so the system stays async-friendly: a future
 *     retry/worker can pick it up.
 *   - WhatsApp is intentionally a no-op stub today. When the WhatsApp
 *     provider lands, only the `case 'whatsapp'` branch needs to change —
 *     no caller updates required.
 *   - PII discipline: `to` and `message` are NEVER logged; only the channel
 *     and a short reason code are.
 */
export async function sendMessage(
  args: SendMessageArgs,
): Promise<MessagingResult> {
  const { channel, to, message } = args;

  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, channel, reason: "empty_message" };
  }

  switch (channel) {
    case "email":
      return await sendViaEmail({
        to,
        message,
        subject: args.subject,
        referenceNumber: args.referenceNumber ?? null,
      });

    case "whatsapp":
      // Future: plug into the WhatsApp Business Cloud API here. Until then,
      // we deliberately do NOT mark the engagement failed — `pending: true`
      // tells the caller to keep status='pending' so the row can be retried
      // by a future worker once the provider is wired up.
      logger.info(
        { channel },
        "WhatsApp send requested but provider is not yet implemented; engagement left pending",
      );
      return {
        ok: false,
        channel,
        pending: true,
        reason: "whatsapp_not_implemented",
      };

    default:
      return { ok: false, channel, reason: "unsupported_channel" };
  }
}

async function sendViaEmail(args: {
  to: string | null | undefined;
  message: string;
  subject?: string;
  referenceNumber: string | null;
}): Promise<MessagingResult> {
  if (!args.to || typeof args.to !== "string" || args.to.trim() === "") {
    // No address on file — nothing to send. Treat as a hard "skip" rather
    // than a transient failure: no point keeping it pending if there's no
    // recipient to retry to.
    return { ok: false, channel: "email", reason: "no_recipient" };
  }

  const subject = args.subject ?? "Update on Your Assessment";
  const text = composeEmailBody({
    message: args.message,
    referenceNumber: args.referenceNumber,
  });

  // Defensive: `sendSafelyForMessaging` already wraps the underlying
  // provider call in try/catch, but it also performs a dynamic import that
  // could in principle throw (e.g. transient module-resolution glitch in
  // a hot-reload edge case). Belt + braces: catch anything here too so the
  // `sendMessage()` "must not throw" contract is unconditionally upheld.
  let result: SendResult;
  try {
    result = await sendSafelyForMessaging({
      to: args.to,
      subject,
      text,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "sendSafelyForMessaging threw unexpectedly; treating as transient",
    );
    return {
      ok: false,
      channel: "email",
      reason: "internal_error",
      pending: true,
    };
  }

  if (result.ok) {
    return { ok: true, channel: "email", id: result.id };
  }

  return {
    ok: false,
    channel: "email",
    reason: result.reason,
    pending: classifyEmailFailure(result.reason),
  };
}

/**
 * Decide whether an email failure reason is "transient" (engagement should
 * stay `pending` so a future worker can retry) or "permanent" (engagement
 * should be marked `failed`).
 *
 * The default is **transient** — we err on the side of leaving rows
 * retryable so transport hiccups don't quietly drop messages. Reasons we
 * KNOW are permanent (forbidden phrase, missing recipient, malformed
 * input) are explicitly listed below.
 *
 * Provider-specific match cues (e.g. "5xx" / "Invalid `to`") are detected
 * by substring rather than exact equality so we don't have to keep a brittle
 * allow-list of every phrase Resend might emit.
 */
function classifyEmailFailure(reason: string): boolean {
  const r = reason.toLowerCase();

  // Permanent: anything that retrying won't fix.
  if (r.startsWith("forbidden_phrase:")) return false;
  if (r === "no_recipient") return false;
  if (r === "empty_message") return false;
  if (r.includes("invalid `to`")) return false;
  if (r.includes("invalid recipient")) return false;
  if (r.includes("invalid email")) return false;
  if (r.includes("validation_error")) return false;

  // Everything else (connector unavailable, network blip, 5xx from Resend,
  // unknown_error, etc.) is treated as transient.
  return true;
}

function composeEmailBody(args: {
  message: string;
  referenceNumber: string | null;
}): string {
  const lines = ["Hello,", "", args.message.trim()];
  if (args.referenceNumber) {
    lines.push("", `Your reference number: ${args.referenceNumber}`);
  }
  lines.push("", "— E-Migration Assist");
  return lines.join("\n");
}

/**
 * Thin wrapper around the existing email module. We don't import the private
 * `sendSafely` helper directly (it's not exported), so we compose by reusing
 * `sendUpdateEmail`'s error-handling discipline through a small adapter that
 * re-implements the safe-send path. To keep behaviour identical to the
 * existing email pipeline (forbidden-phrase screening, never-throw), we route
 * through the public `sendUpdateEmail` wrapper for batch update emails and
 * use a custom path for manual messages.
 */
async function sendSafelyForMessaging(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  // Re-use the same module-level safe-send by importing dynamically. Email
  // module already screens forbidden phrases on subject + body and returns
  // `{ ok: false, reason }` on every failure path.
  const { sendCustomEmail } = await import("./email");
  return sendCustomEmail(args);
}

// Helper kept here for back-compat clarity. The actual sending is delegated
// to `email.ts` which owns the Resend connector and forbidden-phrase screen.
export { sendUpdateEmail };
