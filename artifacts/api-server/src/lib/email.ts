import nodemailer, { type Transporter } from "nodemailer";
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

// Canonical sender for ALL platform communications (campaigns, test sends,
// OTPs, confirmations, internal notifications). Override with the EMAIL_FROM
// env var if the address ever changes. NOTE: the Resend account must have the
// sending domain (emigration-assist.com) verified or sends will be rejected.
const SPEC_FROM_EMAIL = "info@emigration-assist.com";
const SPEC_FROM_NAME = "E-Migration Assist";

let cachedSettings: { apiKey: string; fromEmail: string } | null = null;

/**
 * SMTP transport for production (e.g. AWS EC2 → Office 365 SMTP). Only
 * active when NODE_ENV=production AND all five SMTP_* / EMAIL_FROM vars
 * are set. Cached for the process lifetime.
 *
 * Replit dev + Replit deployment intentionally bypass this path and keep
 * using the existing Resend/Connector flow — no behavioural change there.
 */
let cachedSmtp:
  | { transporter: Transporter; from: string; loggedActiveProvider: boolean }
  | null = null;

function loadSmtpTransport(): {
  transporter: Transporter;
  from: string;
} | null {
  if (cachedSmtp) return cachedSmtp;

  if (process.env.NODE_ENV !== "production") return null;

  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  const fromEmail = process.env.EMAIL_FROM?.trim();

  if (!host || !portRaw || !user || !pass || !fromEmail) return null;

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    logger.error({ portRaw }, "SMTP_PORT is not a valid TCP port; skipping SMTP");
    return null;
  }

  // 465 → implicit TLS (secure:true). 587/25 → STARTTLS upgrade (secure:false).
  const secure = port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  cachedSmtp = {
    transporter,
    from: `${SPEC_FROM_NAME} <${fromEmail}>`,
    loggedActiveProvider: false,
  };
  return cachedSmtp;
}

/**
 * Resolve Resend credentials in two modes:
 *
 *   1. Production / portable hosts (AWS EC2, Docker, anywhere outside
 *      Replit): read `RESEND_API_KEY` + `EMAIL_FROM` directly from env.
 *      This path has zero dependency on Replit-injected variables.
 *
 *   2. Replit (dev workspace + Replit deployments): fall back to the
 *      Replit Connectors HTTP API, which mints short-lived Resend
 *      credentials from the linked connector. Keeps the dev flow
 *      identical to what it was before.
 *
 * Result is cached for the process lifetime. Throws with a clear message
 * when neither path is configured — callers (`sendSafely`) catch and
 * log via the recipient-redacted `logger.warn` path.
 */
async function loadResendSettings(): Promise<{ apiKey: string; fromEmail: string }> {
  if (cachedSettings) return cachedSettings;

  // Path 1: explicit env vars (production / non-Replit hosts).
  const envApiKey = process.env.RESEND_API_KEY?.trim();
  const envFromEmail = process.env.EMAIL_FROM?.trim();
  if (envApiKey && envFromEmail) {
    logger.info(
      { provider: "resend", source: "env" },
      "Email provider active: Resend (env vars)",
    );
    cachedSettings = { apiKey: envApiKey, fromEmail: envFromEmail };
    return cachedSettings;
  }

  // Path 2: Replit Connectors fallback (dev / Replit deployments).
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    logger.error(
      {
        hasResendApiKey: Boolean(envApiKey),
        hasEmailFrom: Boolean(envFromEmail),
        hasReplitConnectorsHostname: Boolean(hostname),
        hasReplitIdentity: Boolean(process.env.REPL_IDENTITY),
        hasWebReplRenewal: Boolean(process.env.WEB_REPL_RENEWAL),
      },
      "Email send unavailable: set RESEND_API_KEY+EMAIL_FROM (production) " +
        "or run inside Replit with Resend connector linked (dev).",
    );
    throw new Error(
      "Email credentials missing: set RESEND_API_KEY and EMAIL_FROM, " +
        "or run inside Replit with the Resend connector linked.",
    );
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
  // Prefer the explicit EMAIL_FROM override, then our canonical platform
  // sender. We intentionally do NOT use the connector's `from_email` here —
  // it points at a legacy domain and would override the address every
  // platform communication is required to send from.
  const fromEmail = process.env.EMAIL_FROM?.trim() || SPEC_FROM_EMAIL;
  logger.info(
    { provider: "resend", source: "replit-connector" },
    "Email provider active: Resend (Replit connector)",
  );
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
  replyTo?: string;
  /**
   * Internal ops notifications (e.g. support-widget queries) carry
   * user-authored free text that may legitimately contain words on the
   * client-facing forbidden-phrase list (e.g. "rejected"). Skipping the
   * screen for these prevents a user's wording from silently dropping an
   * internal alert. NEVER set this for client-facing mail.
   */
  skipPhraseScreen?: boolean;
}): Promise<SendResult> {
  const blocked = args.skipPhraseScreen
    ? null
    : (findForbiddenPhrase(args.subject) ?? findForbiddenPhrase(args.text));
  if (blocked) {
    // NOTE: subject is operator-supplied for manual sends, so it CAN contain
    // PII (e.g. a name). Log only the matched phrase, not the subject.
    logger.error(
      { phrase: blocked },
      "Email blocked: forbidden phrase",
    );
    return { ok: false, reason: `forbidden_phrase:${blocked}` };
  }

  // (A) Production SMTP path — only when NODE_ENV=production AND all five
  // SMTP_* / EMAIL_FROM vars are configured. Replit dev and Replit
  // deployment skip this and continue to the Resend / Connector path
  // unchanged.
  const smtp = loadSmtpTransport();
  if (smtp) {
    if (!cachedSmtp!.loggedActiveProvider) {
      logger.info(
        { provider: "smtp", host: process.env.SMTP_HOST, port: process.env.SMTP_PORT },
        "Email provider active: SMTP (production)",
      );
      cachedSmtp!.loggedActiveProvider = true;
    }
    try {
      const info = await smtp.transporter.sendMail({
        from: smtp.from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      });
      return { ok: true, id: info.messageId ?? "" };
    } catch (err) {
      logger.warn(
        { err, recipient: redactRecipient(args.to) },
        "SMTP send threw",
      );
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "unknown_error",
      };
    }
  }

  // (B) Resend path — env-var creds (production-without-SMTP) or Replit
  // Connector fallback (dev / Replit deployment).
  try {
    const { client, from } = await getResend();
    const r = await client.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
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

/**
 * Shared confirmation body used by BOTH the email path (sendConfirmationEmail)
 * and the WhatsApp path in routes/leads.ts. Centralised so the lead always
 * sees the same client-facing message regardless of which channel they
 * preferred.
 *
 * Tone: friendly, addressed to the client by name, with a clear action
 * promise ("a consultant will be in touch"). Reference number is kept at
 * the bottom so the lead — or our team in follow-up — can use it for
 * status lookup, but it is intentionally not the headline.
 *
 * `fullName` is optional so the helper degrades gracefully to a generic
 * "Hello," if the lead row somehow lacks a name.
 */
export function composeConfirmationBody(args: {
  referenceNumber: string;
  fullName?: string | null;
}): string {
  const greetName =
    typeof args.fullName === "string" && args.fullName.trim().length > 0
      ? args.fullName.trim()
      : null;
  return [
    greetName ? `Hello ${greetName},` : "Hello,",
    "",
    "Thank you — your submission has been received and your preliminary report is being prepared.",
    "",
    "Following your preliminary report, please await an invitation to register for and subscribe to the E-Migration Assist case management platform, which will assist you in meeting your specific individual immigration needs.",
    "",
    `Reference: ${args.referenceNumber}`,
    "",
    "— E-Migration Assist",
  ].join("\n");
}

export async function sendConfirmationEmail(args: {
  to: string;
  referenceNumber: string;
  fullName?: string | null;
}): Promise<SendResult> {
  const subject = "Your Assessment Has Been Received";
  const text = composeConfirmationBody({
    referenceNumber: args.referenceNumber,
    fullName: args.fullName,
  });

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

/**
 * Internal operational notification (NOT client-facing). Used for things
 * like support-widget queries that must reach the team inbox. Skips the
 * forbidden-phrase screen because the body carries user-authored free text,
 * and optionally sets a Reply-To so the team can answer the submitter
 * directly.
 */
export async function sendInternalNotificationEmail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  // Defensive: only forward a Reply-To that looks like a single, plain email
  // address. Guards against a future call site passing unvalidated input that
  // could carry header-injection payloads.
  const safeReplyTo =
    args.replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.replyTo.trim())
      ? args.replyTo.trim()
      : undefined;
  return sendSafely({
    to: args.to,
    subject: args.subject,
    text: args.text,
    skipPhraseScreen: true,
    ...(safeReplyTo ? { replyTo: safeReplyTo } : {}),
  });
}
