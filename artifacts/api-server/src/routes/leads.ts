import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  analyticsEventsTable,
  leadEngagementsTable,
  leadCasesTable,
} from "@workspace/db";
import { CreateLeadBody, ListLeadsQueryParams } from "@workspace/api-zod";
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  classifyCase,
  deriveAutoPriority,
  deriveNextStep,
  generateReferenceNumber,
} from "../lib/classification";
import { normalizeWhatsapp } from "../lib/whatsapp";
import { buildConfirmationDispatcher } from "../lib/confirmation";
import { recordLeadEvent } from "../lib/recordLeadEvent";
import { requireAdminToken } from "../lib/adminAuth";
import { findUsableVerifiedOtp } from "../lib/otp";
import { createRateBucket } from "../lib/rateLimit";
import { sanitizeFunnelContext } from "../lib/funnelContext";
import { deriveClientPortalStatus } from "../lib/clientPortal";

// Pre-traffic hardening: per-key sliding-window limiters guarding the
// public lead-submission endpoint against scripted abuse. Three
// independent buckets — IP, canonical WhatsApp number, normalised email
// — so an attacker cannot rotate one dimension to bypass the others.
// Generous enough that a real user resubmitting the form a few times
// (typo fix, cold-feet retry) is never blocked.
const leadRateLimitByIp = createRateBucket({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
});
const leadRateLimitByEmail = createRateBucket({
  windowMs: 60 * 60 * 1000,
  max: 5,
});
const leadRateLimitByWhatsapp = createRateBucket({
  windowMs: 60 * 60 * 1000,
  max: 5,
});

const router: IRouter = Router();

// Phase 2 — attribution allow-list. Anything off-list is coerced to
// "other" rather than rejected so a stale embed doesn't 400 out.
const ALLOWED_SOURCES = new Set([
  "web_form",
  "overstay_intake",
  "referral",
  "linkedin",
  "facebook",
  "google",
  "direct",
  "csv_import",
  "manual",
  "api",
  "other",
]);

function normalizeSource(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  return ALLOWED_SOURCES.has(t) ? t : "other";
}

function normalizeCampaign(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > 120 ? t.slice(0, 120) : t;
}

function serializeLead(
  row: typeof prelaunchLeadsTable.$inferSelect,
  caseId: string | null = null,
  caseWorkflow: { key: string | null; status: string | null } | null = null,
  casePortalStatusRaw: string | null = null,
) {
  return {
    ...row,
    visaExpiryDate: row.visaExpiryDate ?? null,
    exitDate: row.exitDate ?? null,
    consentTimestamp: row.consentTimestamp
      ? row.consentTimestamp.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
    nextStep: deriveNextStep(row.leadStatus),
    // Lead → Case linkage.  null until the lead reaches `converted` (see
    // ensureCaseForLead in lib/cases.ts).  Read via LEFT JOIN so list and
    // detail responses stay a single round-trip.
    caseId,
    // Phase 12C — workflow attachment state on the linked case, read via the
    // same LEFT JOIN. null for unconverted leads; 'assigned' (workflowKey set),
    // 'review_required', or legacy 'unassigned' once a case exists.
    caseWorkflowKey: caseWorkflow?.key ?? null,
    caseWorkflowStatus: caseWorkflow?.status ?? null,
    // Phase 13A — read-only client-portal readiness. Derived (never written)
    // from the persisted portal_status + workflow state; null until converted.
    casePortalStatus: caseId
      ? deriveClientPortalStatus({
          portalStatus: casePortalStatusRaw,
          workflowStatus: caseWorkflow?.status ?? null,
        })
      : null,
  };
}

// Admin LIST serializer.  Exposes ONLY the dashboard's spec'd fields plus
// `referenceNumber` (used for row testids and cross-reference in the UI).
// Crucially, it omits internal "rules engine" fields — `internalClassification`,
// `leadScore`, `leadCategory`, `adminNotes` — and bulky funnel data the
// dashboard does not need.  Per spec: "Do NOT expose rules engine data yet."
function serializeLeadAdminList(
  row: typeof prelaunchLeadsTable.$inferSelect,
  caseId: string | null = null,
) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    fullName: row.fullName,
    email: row.email,
    whatsapp: row.whatsapp,
    immigrationSituation: row.immigrationSituation,
    leadStatus: row.leadStatus,
    leadPriority: row.leadPriority,
    // CRM Phase A — surface the dual-lead discriminator + assignment/follow-up
    // fields the dashboard will start consuming in Phase C/D. These mirror
    // AdminLeadListItem in openapi.yaml; if you add a column here, add it
    // there too (and re-run codegen).
    leadType: row.leadType,
    inquiryType: row.inquiryType,
    source: row.source,
    sourceCampaign: row.sourceCampaign,
    // Surface organizationName so professional (B2B) rows have a
    // human-readable identifier in the dashboard list — they typically
    // have a null fullName because the contact-person field is captured
    // separately in `representativeName`.
    organizationName: row.organizationName,
    // Phase 5 §5 — Type-of-Enquiry derivation needs the B2B sizing
    // signals to distinguish "Enterprise Demo Request" from the
    // default "Professional Partnership". Surfaced on the slim list
    // row so the dashboard column can render correctly without an
    // extra round-trip per row.
    organizationType: row.organizationType,
    estimatedClientVolume: row.estimatedClientVolume,
    // Phase 6A — B2B contact intelligence surfaced on the email-pill
    // hover-card. The slim list endpoint must include enough rep info
    // to render the tooltip without an N+1 fetch per row.
    representativeName: row.representativeName,
    representativeEmail: row.representativeEmail,
    representativeRole: row.representativeRole,
    representativeRelationship: row.representativeRelationship,
    firmSize: row.firmSize,
    serviceFocus: row.serviceFocus,
    // Phase 6A.5 — surface the tier on the slim list so the dashboard can
    // render its tier-mix badge / filter without an N+1 detail fetch.
    intendedTier: row.intendedTier,
    // Phase 4 (funnel context) — surface the saved landing-page route/theme
    // so the dashboard can show where each lead came from. Read-only; the
    // column is populated at submission time (see lib/funnelContext.ts).
    funnelContext: row.funnelContext ?? null,
    assignedTo: row.assignedTo,
    lastContactedAt: row.lastContactedAt
      ? row.lastContactedAt.toISOString()
      : null,
    nextFollowUpAt: row.nextFollowUpAt
      ? row.nextFollowUpAt.toISOString()
      : null,
    followUpNote: row.followUpNote ?? null,
    tags: row.tags,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
    createdAt: row.createdAt.toISOString(),
    // Conversion-funnel hint derived from leadStatus.  See `deriveNextStep`.
    nextStep: deriveNextStep(row.leadStatus),
    // Lead → Case linkage; powers the "Open Case" quick-action in /admin.
    caseId,
  };
}

// Public-safe view of a lead for the user-facing reference lookup. Strips out
// every internal CRM field (score, priority, internalClassification,
// leadStatus, adminNotes) and contact PII that the lookup page does not need
// to render.
function serializeLeadPublic(row: typeof prelaunchLeadsTable.$inferSelect) {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    fullName: row.fullName,
    nationality: row.nationality,
    immigrationSituation: row.immigrationSituation,
    leadCategory: row.leadCategory,
    consentAccepted: row.consentAccepted,
    consentTimestamp: row.consentTimestamp
      ? row.consentTimestamp.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const toDateString = (d: Date | undefined): string | null =>
  d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toISOString().slice(0, 10)
    : null;

// Build a request-scoped confirmation dispatcher.  Extracted from the
// inline closure in POST /leads so the same logic can run from the new
// POST /leads/:id/finalize route — V2 defers confirmation send until the
// user reaches the documents-question gate (or skips documents and goes
// straight to the summary).

router.post("/leads", async (req, res) => {
  // Pre-traffic hardening: honeypot field. The form must NOT render a
  // visible input named `website`; legitimate submissions therefore
  // never include it. Bots that scrape and fill every input will set
  // it. We respond 201 with a synthetic-but-realistic-looking shape
  // (no DB write, no email, no WhatsApp) so the bot believes it
  // succeeded and does not retry.
  const honeypot = (req.body as { website?: unknown } | null | undefined)
    ?.website;
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    req.log.warn(
      { ip: req.ip },
      "Lead honeypot tripped — silently rejecting (no row created)",
    );
    return res.status(201).json({
      id: "00000000-0000-0000-0000-000000000000",
      referenceNumber: "EMA-PENDING-OK",
      ok: true,
    });
  }

  // Pre-traffic hardening: rate-limit on three orthogonal axes so an
  // attacker cannot rotate one dimension to bypass the others. We
  // evaluate IP first (cheapest) then the contact dimensions; the
  // first bucket that trips returns 429 with Retry-After. We do this
  // BEFORE zod parsing so a malformed-but-spammy request still pays
  // the IP-bucket cost.
  const ipKey = req.ip ?? "unknown";
  const ipDecision = leadRateLimitByIp.hit(ipKey);
  if (!ipDecision.ok) {
    res.setHeader("Retry-After", String(ipDecision.retryAfterSec));
    return res
      .status(429)
      .json({ error: "Too many submissions. Please try again later." });
  }

  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const data = parsed.data;

  // NOTE: per-email and per-WhatsApp rate-limit buckets are charged
  // ONLY AFTER OTP verification succeeds (further down). Charging them
  // here would let an attacker burn a victim's contact bucket (5/hr)
  // with un-verified spam, locking the real user out of submitting.
  // V2: the assessment UI sends `finalize: false` when it just needs a
  // lead row to attach documents to.  The confirmation message is then
  // dispatched via POST /leads/:id/finalize at the very end of the flow
  // (whether the user uploaded documents or skipped them).  Default true
  // preserves backwards compatibility for any existing callers (CLI
  // smoke tests, older clients).
  const finalize = (req.body as { finalize?: unknown }).finalize !== false;

  if (!data.consentAccepted) {
    return res.status(400).json({ error: "Consent is required" });
  }

  // V2: contact verification is mandatory.  The frontend obtains a
  // verifiedOtpId from POST /api/otp/verify and forwards it here.  We
  // confirm the proof is fresh (consumed within 30 min) AND that the
  // verified channel matches the contact we are about to persist.
  // Bypass for non-production environments only when the explicit env
  // flag is set, so automated/CLI smoke tests can still create leads.
  const bypass =
    process.env["NODE_ENV"] !== "production" &&
    process.env["DISABLE_OTP_VERIFICATION"] === "1";
  const normalizedWhatsappEarly = normalizeWhatsapp(data.whatsapp);
  if (!bypass) {
    const otpId = (req.body as { verifiedOtpId?: unknown }).verifiedOtpId;
    if (typeof otpId !== "string" || otpId.length === 0) {
      return res
        .status(400)
        .json({ error: "Contact verification is required" });
    }
    const verified = await findUsableVerifiedOtp(otpId);
    if (!verified) {
      return res
        .status(400)
        .json({ error: "Verification has expired — please verify again" });
    }
    const matchesEmail =
      verified.channel === "email" &&
      typeof verified.email === "string" &&
      verified.email.toLowerCase() === data.email.toLowerCase();
    const matchesWhatsapp =
      verified.channel === "whatsapp" &&
      typeof verified.whatsapp === "string" &&
      verified.whatsapp === normalizedWhatsappEarly;
    if (!matchesEmail && !matchesWhatsapp) {
      return res.status(400).json({
        error:
          "Verified contact does not match — please verify again with the contact you are submitting",
      });
    }
  }

  // Pre-traffic hardening: per-email and per-canonical-WhatsApp rate
  // limits. Charged HERE (post-OTP) rather than alongside the IP bucket
  // so an attacker cannot burn a victim's contact bucket (5/hr) with
  // unverified spam — every charge is preceded by a successful OTP
  // proof that the submitter controls that contact channel. In dev /
  // OTP-disabled mode the buckets still apply, just without the
  // proof-of-work gate.
  const normalizedEmailForLimit = data.email
    ? data.email.trim().toLowerCase()
    : null;
  if (normalizedEmailForLimit) {
    const dec = leadRateLimitByEmail.hit(normalizedEmailForLimit);
    if (!dec.ok) {
      res.setHeader("Retry-After", String(dec.retryAfterSec));
      return res
        .status(429)
        .json({ error: "Too many submissions. Please try again later." });
    }
  }
  if (normalizedWhatsappEarly) {
    const dec = leadRateLimitByWhatsapp.hit(normalizedWhatsappEarly);
    if (!dec.ok) {
      res.setHeader("Retry-After", String(dec.retryAfterSec));
      return res
        .status(429)
        .json({ error: "Too many submissions. Please try again later." });
    }
  }

  const dispatchConfirmation = buildConfirmationDispatcher({ log: req.log });

  // WhatsApp: normalise to canonical +E.164. Invalid → store null. Submission
  // is NEVER blocked on a bad number. Raw user input is intentionally not
  // persisted (stored value is always either the canonical form or null).
  const normalizedWhatsapp = normalizedWhatsappEarly;

  const result = classifyCase({
    immigrationSituation: data.immigrationSituation ?? null,
    overstayReason: data.overstayReason ?? null,
    hasSupportingDocuments: data.hasSupportingDocuments ?? null,
  });
  // Auto-priority is computed from the visa/situation context (NOT the score),
  // so a fresh insert always has a sensible default.  Admin can override via
  // PATCH /api/admin/leads/:id.
  const priority = deriveAutoPriority(
    data.immigrationSituation ?? null,
    data.visaHistory ?? null,
  );
  const now = new Date();

  // Uniqueness rule: an email or canonical WhatsApp number may only be
  // registered once. A repeat submission is blocked (409) and the caller
  // is handed back the existing reference so they can look up their status
  // instead of creating a second record.
  const dupConditions = [];
  if (data.email)
    dupConditions.push(
      sql`lower(${prelaunchLeadsTable.email}) = lower(${data.email})`,
    );
  if (normalizedWhatsapp)
    dupConditions.push(eq(prelaunchLeadsTable.whatsapp, normalizedWhatsapp));

  let existing: typeof prelaunchLeadsTable.$inferSelect | undefined;
  if (dupConditions.length > 0) {
    const rows = await db
      .select()
      .from(prelaunchLeadsTable)
      .where(or(...dupConditions))
      .orderBy(desc(prelaunchLeadsTable.createdAt))
      .limit(1);
    existing = rows[0];
  }

  if (existing) {
    req.log.info(
      { leadId: existing.id, referenceNumber: existing.referenceNumber },
      "Duplicate submission blocked — already registered",
    );
    return res.status(409).json({
      error: "already_registered",
      message:
        "This email or contact number is already registered with us. We already have your details on file.",
      referenceNumber: existing.referenceNumber,
    });
  }

  const referenceNumber = generateReferenceNumber();

  const [inserted] = await db
    .insert(prelaunchLeadsTable)
    .values({
      referenceNumber,
      fullName: data.fullName,
      email: data.email,
      whatsapp: normalizedWhatsapp,
      nationality: data.nationality,
      countryOfResidence: data.countryOfResidence ?? null,
      currentlyInSouthAfrica: data.currentlyInSouthAfrica ?? null,
      passportStatus: data.passportStatus ?? null,
      visaHistory: data.visaHistory ?? null,
      immigrationSituation: data.immigrationSituation,
      visaExpiryDate: toDateString(data.visaExpiryDate),
      exitDate: toDateString(data.exitDate),
      borderDocumentIssued: data.borderDocumentIssued ?? null,
      overstayReason: data.overstayReason ?? null,
      hasSupportingDocuments: data.hasSupportingDocuments ?? null,
      previousOverstay: data.previousOverstay ?? null,
      preferredContactMethod: data.preferredContactMethod ?? null,
      consentAccepted: data.consentAccepted,
      consentTimestamp: now,
      internalClassification: result.category,
      leadScore: result.score,
      leadCategory: result.label,
      leadPriority: priority,
      leadStatus: "new",
      // Phase 2 attribution: trust the client-supplied source only if it
      // matches the allow-list, otherwise coerce to "other"; absence
      // falls back to the column default ("web_form"). Campaign is
      // free-text but trimmed and capped to keep storage bounded.
      source: normalizeSource(data.source),
      sourceCampaign: normalizeCampaign(data.sourceCampaign),
      // Phase 3 — persist landing-page funnel context (route/theme) if the
      // client forwarded it. Read straight off req.body (not CreateLeadBody)
      // so the questionnaire validation schema is untouched.
      funnelContext: sanitizeFunnelContext(
        (req.body as { funnelContext?: unknown }).funnelContext,
      ),
    })
    .returning();

  if (!inserted) {
    return res.status(500).json({ error: "Failed to create lead" });
  }

  // Fire-and-forget classification_result analytics event
  db.insert(analyticsEventsTable)
    .values({
      eventName: "classification_result",
      leadId: inserted.id,
      referenceNumber: inserted.referenceNumber,
      payload: {
        category: result.category,
        label: result.label,
        score: result.score,
        priority,
      },
    })
    .catch((err) => req.log.error({ err }, "Failed to log analytics event"));

  // Fire-and-forget whatsapp capture analytics. NO PII — only the boolean
  // flag and the inquiry id (lead id) are stored.
  db.insert(analyticsEventsTable)
    .values({
      eventName: "lead.whatsapp_captured",
      leadId: inserted.id,
      referenceNumber: inserted.referenceNumber,
      payload: {
        inquiryId: inserted.id,
        hasWhatsapp:
          typeof inserted.whatsapp === "string" && inserted.whatsapp.length > 0,
      },
    })
    .catch((err) =>
      req.log.error({ err }, "Failed to log whatsapp_captured event"),
    );

  // V2: defer confirmation when the client is just creating the row to
  // attach documents (finalize=false).  Otherwise dispatch immediately.
  if (finalize) {
    dispatchConfirmation(inserted, 0);
  }

  // Phase 6B PR 4 — emit the canonical `lead_created` scoring event.
  // Backfill seeded one of these for every pre-existing lead, so going
  // forward every lead row in the system has exactly one matching event.
  // Fire-and-forget: a write failure is logged inside recordLeadEvent
  // and must never mask the 201 the user sees.
  void recordLeadEvent({
    leadId: inserted.id,
    type: "lead_created",
    source: "system",
  });

  return res.status(201).json(serializeLead(inserted));
});

/**
 * POST /leads/:id/finalize
 *
 * V2 entry point used by the assessment UI to trigger the confirmation
 * email/WhatsApp at the *real* end of the flow — after the user has either
 * uploaded supporting documents or chosen to skip them.  The route is
 * idempotent: the existing 5-minute send-cooldown on `lead_engagements`
 * absorbs accidental double-clicks.  No body is required; we just look the
 * lead up and run the same dispatcher used by POST /leads.
 *
 * Intentionally NOT in OpenAPI — frontend uses raw fetch, mirroring the
 * admin/OTP convention.  Public-safe (no PII echoed).
 */
router.post("/leads/:id/finalize", async (req, res) => {
  const { id } = req.params;
  // Defensive: only accept a UUID, reject anything else fast so we don't
  // even hit the DB on a probe.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: "Invalid lead id" });
  }
  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  const lead = rows[0];
  if (!lead) {
    return res.status(404).json({ error: "Lead not found" });
  }

  // At-most-once defense.  The route is unauthenticated (anyone holding
  // a valid lead UUID can call it), so we explicitly suppress repeated
  // sends by checking for ANY confirmation engagement row (sent OR
  // pending OR failed) before dispatching.  This bounds the abuse
  // surface to "one extra confirmation per leaked UUID" instead of
  // "unlimited re-sends every 5 minutes".  The dispatcher's own
  // cooldown still helps for normal client retries that happen before
  // the engagement row is written.
  const existingEngagements = await db
    .select({ id: leadEngagementsTable.id })
    .from(leadEngagementsTable)
    .where(
      and(
        eq(leadEngagementsTable.leadId, lead.id),
        eq(leadEngagementsTable.type, "confirmation"),
      ),
    )
    .limit(1);

  if (existingEngagements.length > 0) {
    req.log.info(
      { leadId: lead.id },
      "finalize: confirmation engagement already exists — skipping send",
    );
    return res.json({
      finalized: true,
      alreadyFinalized: true,
      referenceNumber: lead.referenceNumber,
    });
  }

  buildConfirmationDispatcher({ log: req.log })(lead, 5);

  // Phase 6B PR 4 — the assessment flow only reaches finalize after the
  // user has answered every step (with or without supporting documents),
  // so this is the right moment to credit `assessment_completed`. The
  // at-most-once gate above guarantees we won't double-fire on retries.
  void recordLeadEvent({
    leadId: lead.id,
    type: "assessment_completed",
    source: "system",
  });

  return res.json({
    finalized: true,
    referenceNumber: lead.referenceNumber,
  });
});

router.get("/leads", async (req, res) => {
  // Admin-only: the list contains PII (full name, email, whatsapp number)
  // and internal CRM fields (priority, status).  The user-facing reference
  // lookup is `GET /leads/:referenceNumber`, which uses `serializeLeadPublic`
  // and is unaffected by this gate.
  if (!(await requireAdminToken(req, res))) return;

  const parsed = ListLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.issues });
  }
  const {
    limit = 50,
    priority,
    status,
    nationality,
    situation,
    leadType,
  } = parsed.data;
  // `leadType` is now part of the codegenned ListLeadsQueryParams schema
  // (enum-validated to "individual" | "professional"), so we can trust it
  // directly here. Anything else is rejected at the parse step above.
  const leadTypeFilter = leadType ?? null;

  // Soft-archive visibility. By default the funnel hides archived leads;
  // pass `?archived=true` to list ONLY archived leads (the dashboard's
  // "Archived" view). Read directly off req.query so we don't have to churn
  // the codegenned ListLeadsQueryParams schema for a UI-only toggle.
  const showArchived = req.query.archived === "true";

  const filters = [];
  filters.push(
    showArchived
      ? isNotNull(prelaunchLeadsTable.archivedAt)
      : isNull(prelaunchLeadsTable.archivedAt),
  );
  if (priority) filters.push(eq(prelaunchLeadsTable.leadPriority, priority));
  if (status) filters.push(eq(prelaunchLeadsTable.leadStatus, status));
  if (nationality)
    filters.push(eq(prelaunchLeadsTable.nationality, nationality));
  if (situation)
    filters.push(eq(prelaunchLeadsTable.immigrationSituation, situation));
  if (leadTypeFilter)
    filters.push(eq(prelaunchLeadsTable.leadType, leadTypeFilter));

  // LEFT JOIN lead_cases so each row carries its caseId (null when no
  // case has been created yet).  The unique constraint on lead_cases.lead_id
  // guarantees at most one matching row per lead, so the join cannot
  // duplicate leads.
  const rows = await db
    .select({
      lead: prelaunchLeadsTable,
      caseId: leadCasesTable.id,
    })
    .from(prelaunchLeadsTable)
    .leftJoin(
      leadCasesTable,
      eq(leadCasesTable.leadId, prelaunchLeadsTable.id),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(prelaunchLeadsTable.createdAt))
    .limit(limit);

  return res.json(rows.map((r) => serializeLeadAdminList(r.lead, r.caseId)));
});

router.get("/leads/export.csv", async (req, res) => {
  // Admin-only: the export contains the same PII as `GET /leads`.  The
  // admin UI calls this with a fetch + `x-admin-token` header and triggers
  // the download via a Blob URL (so we never put the token in the URL).
  if (!(await requireAdminToken(req, res))) return;

  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .orderBy(desc(prelaunchLeadsTable.createdAt));

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = [
    "referenceNumber",
    "name",
    "email",
    "phone",
    "nationality",
    "classification",
    "score",
    "priority",
    "publicLabel",
    "status",
    "createdAt",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.referenceNumber,
        r.fullName,
        r.email,
        r.whatsapp,
        r.nationality,
        r.internalClassification,
        r.leadScore,
        r.leadPriority,
        r.leadCategory,
        r.leadStatus,
        r.createdAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const filename = `ema-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  return res.send(csv);
});

router.get("/leads/by-id/:id", async (req, res) => {
  // Admin-only: returns the full lead record including PII (email, whatsapp)
  // and operator-only `adminNotes`.  The user-facing reference lookup is
  // `GET /leads/:referenceNumber`, which uses `serializeLeadPublic`.
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  const rows = await db
    .select({
      lead: prelaunchLeadsTable,
      caseId: leadCasesTable.id,
      caseWorkflowKey: leadCasesTable.workflowKey,
      caseWorkflowStatus: leadCasesTable.workflowStatus,
      casePortalStatus: leadCasesTable.portalStatus,
    })
    .from(prelaunchLeadsTable)
    .leftJoin(
      leadCasesTable,
      eq(leadCasesTable.leadId, prelaunchLeadsTable.id),
    )
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return res.status(404).json({ error: "Lead not found" });
  }

  return res.json(
    serializeLead(
      rows[0].lead,
      rows[0].caseId,
      {
        key: rows[0].caseWorkflowKey,
        status: rows[0].caseWorkflowStatus,
      },
      rows[0].casePortalStatus,
    ),
  );
});

// NOTE: PATCH /leads/by-id/:id (status/notes editor) was removed and replaced
// by the token-gated PATCH /api/admin/leads/:id route in adminLeads.ts.  The
// old route was unauthenticated, which conflicts with the rule that
// admin-only mutations must remain admin-only.

router.get("/leads/:referenceNumber", async (req, res) => {
  const { referenceNumber } = req.params;
  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.referenceNumber, referenceNumber))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return res.status(404).json({ error: "Lead not found" });
  }

  // Public lookup → strip internal CRM fields
  return res.json(serializeLeadPublic(rows[0]));
});

export default router;

// Keep sql import used for analytics; quiet TS unused warning
void sql;
