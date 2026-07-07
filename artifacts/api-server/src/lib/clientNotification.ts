import { normalizeWhatsapp } from "./whatsapp";
import { renderTemplate, type RenderContext } from "./campaignRender";
import { resolveWorkflow } from "./leadToApplication";

/**
 * Milestone 5 — Phase 14A: client-activation notification PREPARATION.
 *
 * This module is the SINGLE SOURCE OF TRUTH for deciding *what would be sent*
 * to a client when their portal is activated — WITHOUT sending anything. It is
 * strictly preparation only: it inspects a converted case's signals, decides
 * whether an activation notification could be sent, composes the email/WhatsApp
 * previews that WOULD go out, and reports exactly what is missing or blocking.
 *
 * DELIBERATELY OUT OF SCOPE (do NOT add here — later phases own these):
 *   - Sending email / WhatsApp (no call to email.ts / whatsappClient.ts).
 *   - Enqueuing anything (no pg-boss, no queue).
 *   - Writing audit rows (see `buildAuditDescriptor` — it returns a ready
 *     payload but NEVER calls the audit system).
 *   - Any DB mutation or network call. This function is PURE.
 *
 * REUSE, don't reinvent:
 *   - `normalizeWhatsapp` (whatsapp.ts) decides WhatsApp reachability the exact
 *     same way lead submission does, so the preview can't disagree with a real
 *     send about whether a number is dialable.
 *   - `renderTemplate` (campaignRender.ts) renders the greeting with the same
 *     strict {{token}} vocabulary the campaign editor uses — no new templating
 *     engine, no token that could leak unrendered.
 *   - `resolveWorkflow` (leadToApplication.ts) turns a stored workflow_key into
 *     its human label from the canonical registry (never a guessed label).
 *
 * HONESTY RULE: never guess. A value with no source (consultant, portal URL,
 * client name, …) stays `null` and is reported as missing rather than invented.
 */

export type NotificationChannel = "email" | "whatsapp";

/**
 * The overall verdict for sending an activation notification:
 *   - `ready`               : a notification could be sent right now.
 *   - `blocked`             : a hard precondition fails (portal not activated);
 *                             sending now would be premature regardless of data.
 *   - `missing_information` : the portal is activated but required data (a
 *                             reachable channel, client name, case reference)
 *                             is absent, so nothing can be composed yet.
 */
export type NotificationReadiness = "ready" | "blocked" | "missing_information";

/** Whether a single channel could carry the message, and where it would go. */
export interface ChannelAvailability {
  channel: NotificationChannel;
  available: boolean;
  /** The resolved destination (email address / E.164 number), else null. */
  destination: string | null;
  /** Why the channel is unavailable, when it is not. Null when available. */
  reason: string | null;
}

/**
 * What a single channel's message WOULD contain. When the channel is
 * unavailable, `available` is false and the body/subject are null — nothing
 * would be sent on that channel.
 */
export interface NotificationMessagePreview {
  channel: NotificationChannel;
  available: boolean;
  /** Email subject; always null for WhatsApp. */
  subject: string | null;
  /** The composed body, or null when nothing would be sent. */
  body: string | null;
}

/**
 * The inputs the preview is built from. The CALLER assembles this from the DB
 * (lead + linked case + resolved consultant) so this module stays pure — it
 * never reads the database itself and never resolves names on its own.
 */
export interface NotificationCaseContext {
  leadId: string;
  /** Client full name (lead.fullName). Null when the funnel never captured it. */
  clientName: string | null;
  /** Raw email as stored on the lead. */
  email: string | null;
  /** Raw WhatsApp/phone as stored on the lead (normalised here). */
  whatsapp: string | null;
  preferredContactMethod: string | null;
  /** Client-facing case reference (case.referenceNumber ?? lead.referenceNumber). */
  caseReference: string | null;
  /** The DERIVED client-portal status (see deriveClientPortalStatus). */
  portalStatus: string;
  /** Persisted workflow key on the case (resolved to a label here). */
  workflowKey: string | null;
  /** Persisted workflow status on the case. */
  workflowStatus: string | null;
  /**
   * The assigned consultant, ALREADY resolved by the caller, or null when the
   * lead is unassigned. Never resolved or guessed inside this module.
   */
  consultant: { id: string; name: string | null } | null;
  /**
   * The client's portal URL IF it is already known. There is no real portal
   * route yet, so this is normally null — never fabricated from a base URL.
   */
  portalUrl: string | null;
}

/** The workflow, resolved to a display label where possible. */
export interface NotificationWorkflowInfo {
  key: string | null;
  label: string | null;
  status: string | null;
}

export interface NotificationSummary {
  clientName: string | null;
  caseReference: string | null;
  portalStatus: string;
  workflow: NotificationWorkflowInfo;
  consultant: { id: string; name: string | null } | null;
  portalUrl: string | null;
  email: ChannelAvailability;
  whatsapp: ChannelAvailability;
}

/**
 * A ready-to-write audit payload for the future notification events. This
 * module NEVER writes it (Phase 14A is preparation only) — a later phase can
 * pass this straight to `writeAudit`. The verb is intentionally a plain string
 * and is deliberately NOT added to the `AuditAction` union yet, so nothing
 * implies it is wired up.
 */
export interface NotificationAuditDescriptor {
  action: "notification_prepared" | "notification_blocked";
  leadId: string;
  after: {
    caseReference: string | null;
    readiness: NotificationReadiness;
    channels: { email: boolean; whatsapp: boolean };
    missingRequirements: string[];
    blockedReasons: string[];
  };
}

export interface NotificationPreview {
  leadId: string;
  /** When this preview was generated (ISO). Handy for a future audit row. */
  generatedAt: string;
  readiness: NotificationReadiness;
  summary: NotificationSummary;
  email: NotificationMessagePreview;
  whatsapp: NotificationMessagePreview;
  /** Required data absent (only when the portal is activated). */
  missingRequirements: string[];
  /** Hard preconditions that fail (e.g. portal not activated). */
  blockedReasons: string[];
  auditDescriptor: NotificationAuditDescriptor;
}

// ---------------------------------------------------------------------------
// Availability checks — factual, never guessed
// ---------------------------------------------------------------------------

/** Minimal structural email check — presence + a single @ with a dotted host. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveEmail(raw: string | null): string | null {
  const v = (raw ?? "").trim();
  return v.length > 0 && EMAIL_RE.test(v) ? v : null;
}

function emailAvailability(raw: string | null): ChannelAvailability {
  const destination = resolveEmail(raw);
  return {
    channel: "email",
    available: destination !== null,
    destination,
    reason: destination !== null ? null : "No valid email address on file.",
  };
}

function whatsappAvailability(raw: string | null): ChannelAvailability {
  const destination = normalizeWhatsapp(raw);
  return {
    channel: "whatsapp",
    available: destination !== null,
    destination,
    reason:
      destination !== null ? null : "No valid WhatsApp number on file.",
  };
}

// ---------------------------------------------------------------------------
// Message composition — reuses the strict {{token}} renderer
// ---------------------------------------------------------------------------

const EMAIL_SUBJECT = "Your E-Migration Assist client portal is ready";

/** Greeting rendered with the SAME strict vocabulary the campaign editor uses. */
const EMAIL_GREETING =
  "Hi {{first_name}},\n\n" +
  "Good news — your E-Migration Assist case ({{reference}}) is now active and " +
  "your client portal is ready.";

const WHATSAPP_GREETING =
  "Hi {{first_name}}, your E-Migration Assist case ({{reference}}) is now " +
  "active and your client portal is ready.";

function renderCtx(ctx: NotificationCaseContext): RenderContext {
  return {
    fullName: ctx.clientName,
    referenceNumber: ctx.caseReference,
    organizationName: null,
  };
}

/**
 * Compose the trailing lines (consultant + portal access) in code rather than
 * as template tokens — the strict renderer only knows 4 tokens, so putting an
 * unsupported {{portal_url}} in the template would leak it verbatim. Building
 * these conditionally keeps the preview honest: a line only appears when we
 * actually have the data.
 */
function composeTail(ctx: NotificationCaseContext): string {
  const lines: string[] = [];
  if (ctx.consultant?.name) {
    lines.push(`Your assigned consultant is ${ctx.consultant.name}.`);
  }
  if (ctx.portalUrl) {
    lines.push(`Access your portal here: ${ctx.portalUrl}`);
  } else {
    lines.push("We'll share your secure portal access link shortly.");
  }
  return lines.join("\n\n");
}

function composeEmailPreview(
  ctx: NotificationCaseContext,
  available: boolean,
): NotificationMessagePreview {
  if (!available) {
    return { channel: "email", available: false, subject: null, body: null };
  }
  const body = `${renderTemplate(EMAIL_GREETING, renderCtx(ctx))}\n\n${composeTail(
    ctx,
  )}\n\n— The E-Migration Assist team`;
  return { channel: "email", available: true, subject: EMAIL_SUBJECT, body };
}

function composeWhatsappPreview(
  ctx: NotificationCaseContext,
  available: boolean,
): NotificationMessagePreview {
  if (!available) {
    return { channel: "whatsapp", available: false, subject: null, body: null };
  }
  const tail = ctx.portalUrl
    ? ` Access it here: ${ctx.portalUrl}`
    : " We'll share your secure access link shortly.";
  const body = `${renderTemplate(WHATSAPP_GREETING, renderCtx(ctx))}${tail}`;
  return { channel: "whatsapp", available: true, subject: null, body };
}

// ---------------------------------------------------------------------------
// The preparation service
// ---------------------------------------------------------------------------

/**
 * Build a notification preview for a converted case. Pure — no DB, no network,
 * no send. Determines readiness, composes the previews that WOULD be sent, and
 * reports missing/blocking reasons.
 *
 * Readiness precedence:
 *   1. `blocked`             — the portal is not activated. Activation is the
 *      trigger for this notification, so sending before it is premature. Data
 *      gaps are still computed and reported for transparency.
 *   2. `missing_information` — activated, but a required input is absent.
 *   3. `ready`               — activated and everything required is present.
 */
export function buildNotificationPreview(
  ctx: NotificationCaseContext,
): NotificationPreview {
  const email = emailAvailability(ctx.email);
  const whatsapp = whatsappAvailability(ctx.whatsapp);

  const workflowDef = resolveWorkflow(ctx.workflowKey);
  const workflow: NotificationWorkflowInfo = {
    key: ctx.workflowKey,
    label: workflowDef?.label ?? null,
    status: ctx.workflowStatus,
  };

  // Hard precondition: this notification fires ON activation.
  const blockedReasons: string[] = [];
  if (ctx.portalStatus !== "activated") {
    blockedReasons.push(
      `Client portal is not activated yet (status: ${ctx.portalStatus}). Activation notifications are only sent once the portal is activated.`,
    );
  }

  // Required data to actually compose + address a message. Never guessed.
  const missingRequirements: string[] = [];
  if (!ctx.clientName || ctx.clientName.trim().length === 0) {
    missingRequirements.push("Client name");
  }
  if (!ctx.caseReference || ctx.caseReference.trim().length === 0) {
    missingRequirements.push("Case reference");
  }
  if (!email.available && !whatsapp.available) {
    missingRequirements.push("A reachable channel (valid email or WhatsApp)");
  }

  const readiness: NotificationReadiness =
    blockedReasons.length > 0
      ? "blocked"
      : missingRequirements.length > 0
        ? "missing_information"
        : "ready";

  // Only compose a channel's body when the notification is READY — a blocked
  // or incomplete notification shows nothing would be sent yet.
  const composable = readiness === "ready";
  const emailPreview = composeEmailPreview(ctx, composable && email.available);
  const whatsappPreview = composeWhatsappPreview(
    ctx,
    composable && whatsapp.available,
  );

  const summary: NotificationSummary = {
    clientName: ctx.clientName,
    caseReference: ctx.caseReference,
    portalStatus: ctx.portalStatus,
    workflow,
    consultant: ctx.consultant,
    portalUrl: ctx.portalUrl,
    email,
    whatsapp,
  };

  return {
    leadId: ctx.leadId,
    generatedAt: new Date().toISOString(),
    readiness,
    summary,
    email: emailPreview,
    whatsapp: whatsappPreview,
    missingRequirements,
    blockedReasons,
    auditDescriptor: buildAuditDescriptor(
      ctx.leadId,
      ctx.caseReference,
      readiness,
      { email: email.available, whatsapp: whatsapp.available },
      missingRequirements,
      blockedReasons,
    ),
  };
}

/**
 * Build the (unwritten) audit descriptor. `ready` maps to `notification_prepared`;
 * anything else (`blocked` / `missing_information`) maps to `notification_blocked`.
 */
function buildAuditDescriptor(
  leadId: string,
  caseReference: string | null,
  readiness: NotificationReadiness,
  channels: { email: boolean; whatsapp: boolean },
  missingRequirements: string[],
  blockedReasons: string[],
): NotificationAuditDescriptor {
  return {
    action: readiness === "ready" ? "notification_prepared" : "notification_blocked",
    leadId,
    after: {
      caseReference,
      readiness,
      channels,
      missingRequirements,
      blockedReasons,
    },
  };
}
