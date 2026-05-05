import { Resend } from "resend";
import { logger } from "./logger";

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bapproved\b/i,
  /\brejected\b/i,
  /\bguaranteed\b/i,
  /you\s+qualify/i,
  /we\s+will\s+fix/i,
  /home\s+affairs\s+will/i,
  /\bapply\s+now\b/i,
  /\bbook\s+(a\s+)?consultation\b/i,
  /\bpay\s+now\b/i,
  /\bcontact\s+(an?\s+)?agent\b/i,
];

export function findForbiddenPhrase(text: string): string | null {
  for (const re of FORBIDDEN_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

const SPEC_FROM_EMAIL = "no-reply@eridetech.africa";
const SPEC_FROM_NAME = "E-Migration Assist";

let cachedSettings: { apiKey: string; fromEmail: string } | null = null;

async function loadResendSettings(): Promise<{ apiKey: string; fromEmail: string }> {
  if (cachedSettings) return cachedSettings;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Replit connectors host/token not available");
  }

  const res = await fetch(
    "https://" +
      hostname +
      "/api/v2/connection?include_secrets=true&connector_names=resend",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );
  const data = (await res.json()) as {
    items?: { settings?: { api_key?: string; from_email?: string } }[];
  };
  const item = data.items?.[0];
  const apiKey = item?.settings?.api_key;
  if (!apiKey) {
    throw new Error("Resend not connected");
  }
  const fromEmail = item?.settings?.from_email || SPEC_FROM_EMAIL;
  cachedSettings = { apiKey, fromEmail };
  return cachedSettings;
}

async function getResend(): Promise<{ client: Resend; from: string }> {
  const { apiKey, fromEmail } = await loadResendSettings();
  const from = `${SPEC_FROM_NAME} <${fromEmail}>`;
  return { client: new Resend(apiKey), from };
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

/**
 * Redact a recipient email for logging. We never want full addresses ending
 * up in logs (PII). Keep only the domain so an operator triaging a delivery
 * problem can still tell whether it's a corporate / consumer / test domain
 * without exposing the local part.
 *
 *   "ana.silva@example.com"  → "<redacted>@example.com"
 *   "weird-input"            → "<redacted>"
 */
function redactRecipient(to: string): string {
  const at = to.lastIndexOf("@");
  if (at <= 0 || at === to.length - 1) return "<redacted>";
  return `<redacted>@${to.slice(at + 1)}`;
}

async function sendSafely(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  const blocked =
    findForbiddenPhrase(args.subject) ?? findForbiddenPhrase(args.text);
  if (blocked) {
    // NOTE: subject is operator-supplied for manual sends, so it CAN contain
    // PII (e.g. a name). Log only the matched phrase, not the subject.
    logger.error(
      { phrase: blocked },
      "Email blocked: forbidden phrase",
    );
    return { ok: false, reason: `forbidden_phrase:${blocked}` };
  }

  try {
    const { client, from } = await getResend();
    const r = await client.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    if (r.error) {
      logger.warn(
        { err: r.error, recipient: redactRecipient(args.to) },
        "Resend send returned error",
      );
      return { ok: false, reason: r.error.message ?? "resend_error" };
    }
    const id = r.data?.id ?? "";
    return { ok: true, id };
  } catch (err) {
    logger.warn(
      { err, recipient: redactRecipient(args.to) },
      "Resend send threw",
    );
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

export async function sendConfirmationEmail(args: {
  to: string;
  referenceNumber: string;
}): Promise<SendResult> {
  const subject = "Your Assessment Has Been Received";
  const text = [
    "Hello,",
    "",
    "Your information has been securely recorded.",
    "",
    `Your reference number: ${args.referenceNumber}`,
    "",
    "You can check your status anytime using your reference number.",
    "",
    "— E-Migration Assist",
  ].join("\n");

  return sendSafely({ to: args.to, subject, text });
}

export async function sendUpdateEmail(args: {
  to: string;
  referenceNumber: string;
}): Promise<SendResult> {
  const subject = "Update on Your Assessment";
  const text = [
    "Hello,",
    "",
    "We are currently preparing the full system to better assist cases like yours.",
    "",
    `Your reference number: ${args.referenceNumber}`,
    "",
    "You can check your status anytime using your reference number.",
    "",
    "— E-Migration Assist",
  ].join("\n");

  return sendSafely({ to: args.to, subject, text });
}

/**
 * Public escape-hatch for the messaging gateway (`lib/messaging.ts`). Lets
 * the channel-agnostic sender route a fully-rendered subject + body through
 * the same forbidden-phrase screen and never-throw discipline used by all
 * other email paths. Do NOT call directly from route handlers — go through
 * `sendMessage()` so the engagement-row lifecycle stays intact.
 */
export async function sendCustomEmail(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  return sendSafely(args);
}
