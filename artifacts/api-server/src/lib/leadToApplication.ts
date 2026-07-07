import type { PrelaunchLead } from "@workspace/db";
import { classifyCase } from "./classification";
import { deriveReferralPreview } from "./referralService";

/**
 * Milestone 4 — Phase 12A: Lead → EMA Application conversion mapping.
 *
 * This module is the SINGLE SOURCE OF TRUTH for turning a qualified funnel
 * Lead into the shape the main EMA platform expects when an application is
 * created. It is *preparation only*: it inspects a lead, decides what can be
 * transferred, flags what is missing or needs manual completion, and produces
 * a structured conversion preview.
 *
 * DELIBERATELY OUT OF SCOPE (do NOT add here — later phases own these):
 *   - Creating an EMA application / client account / workflow.
 *   - Sending email / WhatsApp.
 *   - Writing audit rows (see `buildAuditDescriptor` — it returns a ready
 *     payload but NEVER calls the audit system).
 *   - Any DB mutation or network call.
 *
 * REUSE, don't reinvent: the EMA-facing applicant contract already lives in
 * `referralService.ts` (`ApplicantPushBody` + `deriveReferralPreview`), the
 * matter/urgency/region derivation is shared with the referral tunnel, and
 * lead classification comes from `classification.ts`. This mapper is a
 * superset view assembled from those existing pieces plus the assessment,
 * funnel-context, and operational data a full application needs.
 *
 * HONESTY RULE: never guess. A field with no source value maps to `null` and
 * is reported as `missing` (or `manual` when the funnel structurally can't
 * ever collect it), rather than being back-filled with an invented default.
 * (Note this differs from `buildApplicantPushBody`, which substitutes an
 * "Applicant" placeholder because the signed push contract needs a non-empty
 * name — the conversion preview must instead surface the gap truthfully.)
 */

// ---------------------------------------------------------------------------
// Target model — the EMA Application create request
// ---------------------------------------------------------------------------

/**
 * The structured request an EMA application create would consume. Grouped to
 * mirror the conversion-preview sections. Every leaf is nullable because the
 * mapper reports gaps rather than inventing values; `null` means "no source
 * data on the lead".
 */
export interface ApplicationCreateRequest {
  applicant: {
    firstName: string | null;
    lastName: string | null;
    nationality: string | null;
    /** Funnel never collects a DOB → always null (manual completion in EMA). */
    dateOfBirth: string | null;
    /** Funnel never collects a passport number → always null (manual). */
    passportNumber: string | null;
  };
  contact: {
    email: string | null;
    phone: string | null;
    preferredContactMethod: string | null;
  };
  assessment: {
    /** Country the applicant is currently in — the "region" for matching. */
    countryOfResidence: string | null;
    /** Intended destination — not captured by the funnel → manual in EMA. */
    destination: string | null;
    currentlyInSouthAfrica: boolean | null;
    immigrationSituation: string | null;
    passportStatus: string | null;
    visaHistory: string | null;
    visaExpiryDate: string | null;
    exitDate: string | null;
    borderDocumentIssued: string | null;
    overstayReason: string | null;
    previousOverstay: string | null;
    hasSupportingDocuments: string | null;
    /** Derived from lead priority (shared with the referral preview). */
    urgency: string | null;
  };
  funnelContext: {
    route: string | null;
    theme: string | null;
    attribution: {
      source: string | null;
      sourceCampaign: string | null;
      landingPage: string | null;
      referrer: string | null;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      utmContent: string | null;
      utmTerm: string | null;
    };
  };
  route: {
    /** Machine matter type (funnel `inquiryType`). */
    matterType: string | null;
    /** Human label for the matter type (shared with the referral preview). */
    matterTypeLabel: string | null;
    leadCategory: string | null;
    internalClassification: string | null;
  };
  workflowCandidate: WorkflowCandidate;
  operational: {
    assignedConsultantId: string | null;
    leadStatus: string | null;
    leadPriority: string | null;
    internalNotes: string | null;
    tags: string[] | null;
  };
  /** Linkage back to the originating funnel lead. */
  source: {
    leadId: string;
    leadType: string;
    referenceNumber: string;
  };
}

/**
 * The EMA workflow/process this lead would most likely open. Derived from the
 * matter type (with route/theme as a fallback). `key` is null when there is
 * not enough signal to recommend one — the operator must pick manually.
 */
export interface WorkflowCandidate {
  key: string | null;
  label: string | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Conversion preview — the summary object + missing-data detection
// ---------------------------------------------------------------------------

/**
 * How badly a field is needed for a valid application:
 *   - `required` : must be present to convert; missing = blocker.
 *   - `optional` : nice to have; missing is never a blocker.
 *   - `manual`   : EMA needs it but the funnel structurally can't supply it,
 *                  so it always requires manual completion in EMA.
 */
export type FieldRequirement = "required" | "optional" | "manual";

/** Whether the mapper found a value for the field. */
export type FieldAvailability = "available" | "missing";

export interface ConversionField {
  /** Dotted path within `ApplicationCreateRequest` (e.g. "applicant.firstName"). */
  key: string;
  label: string;
  requirement: FieldRequirement;
  availability: FieldAvailability;
  /** String-rendered value, or null when missing. Never an invented value. */
  value: string | null;
}

export type ConversionSectionKey =
  | "applicant"
  | "contact"
  | "assessment"
  | "funnelContext"
  | "route"
  | "workflowCandidate"
  | "operational";

export interface ConversionSection {
  key: ConversionSectionKey;
  title: string;
  /** True when every `required` field in the section has a value. */
  complete: boolean;
  fields: ConversionField[];
}

export interface ConversionReadiness {
  /** True when NO required field is missing. Manual/optional gaps don't block. */
  canConvert: boolean;
  requiredAvailable: string[];
  requiredMissing: string[];
  /** Fields that always need manual completion in EMA (DOB, passport, …). */
  manualCompletion: string[];
  optionalAvailable: string[];
  optionalMissing: string[];
}

/**
 * A ready-to-write audit payload for the future "conversion previewed" event.
 * This module NEVER writes it (Phase 12A is preparation only) — a later phase
 * can pass this straight to `writeAudit`. The action verb is intentionally a
 * plain string, NOT added to the `AuditAction` union yet, so nothing implies
 * it is wired up.
 */
export interface ConversionAuditDescriptor {
  action: "lead_conversion_previewed";
  leadId: string;
  after: {
    referenceNumber: string;
    canConvert: boolean;
    requiredMissing: string[];
    manualCompletion: string[];
    workflowCandidate: string | null;
  };
}

export interface ConversionPreview {
  leadId: string;
  referenceNumber: string;
  /** When this preview was generated (ISO). Handy for a future audit row. */
  generatedAt: string;
  application: ApplicationCreateRequest;
  sections: ConversionSection[];
  workflowCandidate: WorkflowCandidate;
  readiness: ConversionReadiness;
  auditDescriptor: ConversionAuditDescriptor;
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/**
 * Split a stored full name into first/last WITHOUT inventing placeholders.
 * Unlike `buildApplicantPushBody`'s `splitName`, an empty name yields nulls so
 * the preview can honestly flag the gap.
 */
function splitNameHonest(fullName: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/**
 * Canonical registry of the EMA workflows this funnel can hand off to. This is
 * the SINGLE SOURCE OF TRUTH for what counts as a "known" workflow — both the
 * candidate derivation below and the Phase 12C attachment step
 * (`resolveWorkflow`) read from it, so a candidate can never name a workflow
 * that the attachment step then fails to recognise. Keys are stable strings
 * (never hard-coded IDs) so they persist safely onto `lead_cases.workflow_key`.
 */
export interface WorkflowDefinition {
  key: string;
  label: string;
}

const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  visa_application: { key: "visa_application", label: "Visa Application" },
  overstay_appeal: { key: "overstay_appeal", label: "Overstay / Appeal" },
  travel_entry_assistance: {
    key: "travel_entry_assistance",
    label: "Travel & Entry Assistance",
  },
};

/**
 * Resolve a candidate workflow key against the canonical registry. Returns the
 * definition when the key is recognised, or `null` when it is unknown / absent
 * — the caller must then flag the case for manual review rather than guess.
 * This is the "workflow resolver" Phase 12C attaches with.
 */
export function resolveWorkflow(key: string | null): WorkflowDefinition | null {
  if (!key) return null;
  return WORKFLOW_DEFINITIONS[key] ?? null;
}

/** Matter type → candidate EMA workflow. Keys mirror funnel `inquiryType`. */
const WORKFLOW_BY_MATTER: Record<string, WorkflowDefinition> = {
  visa_inquiry: WORKFLOW_DEFINITIONS.visa_application!,
  overstay_appeal: WORKFLOW_DEFINITIONS.overstay_appeal!,
  travel_entry_assistance: WORKFLOW_DEFINITIONS.travel_entry_assistance!,
};

/** Funnel route → fallback workflow when there is no explicit matter type. */
const WORKFLOW_BY_ROUTE: Record<string, WorkflowDefinition> = {
  traveller: WORKFLOW_DEFINITIONS.travel_entry_assistance!,
  overstay_undesirable: WORKFLOW_DEFINITIONS.overstay_appeal!,
};

/**
 * Recommend the EMA workflow this lead would open. Prefers the explicit matter
 * type; falls back to the funnel route; otherwise returns a null candidate with
 * a reason so the operator knows to pick one manually. Never guesses silently.
 */
export function deriveWorkflowCandidate(lead: PrelaunchLead): WorkflowCandidate {
  const matter = lead.inquiryType ?? undefined;
  if (matter && WORKFLOW_BY_MATTER[matter]) {
    const w = WORKFLOW_BY_MATTER[matter]!;
    return {
      key: w.key,
      label: w.label,
      reason: `Matched on matter type "${matter}".`,
    };
  }

  const route = lead.funnelContext?.route;
  if (route && WORKFLOW_BY_ROUTE[route]) {
    const w = WORKFLOW_BY_ROUTE[route]!;
    return {
      key: w.key,
      label: w.label,
      reason: `Inferred from funnel route "${route}" (no explicit matter type).`,
    };
  }

  return {
    key: null,
    label: null,
    reason:
      "No matter type or recognised funnel route — a workflow must be selected manually in EMA.",
  };
}

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

/**
 * Map a lead into the EMA `ApplicationCreateRequest`. Pure — no side effects,
 * no DB, no network. Values are copied verbatim where present and left `null`
 * where the lead has no source data.
 */
export function mapLeadToApplication(
  lead: PrelaunchLead,
): ApplicationCreateRequest {
  const { firstName, lastName } = splitNameHonest(lead.fullName);
  // Reuse the referral tunnel's shared derivation for matter/urgency/region so
  // the conversion and the referral push can never drift apart.
  const preview = deriveReferralPreview(lead);

  const leadCategory =
    lead.leadCategory ??
    classifyCase({
      immigrationSituation: lead.immigrationSituation,
      overstayReason: lead.overstayReason,
      hasSupportingDocuments: lead.hasSupportingDocuments,
    }).label;
  const internalClassification =
    lead.internalClassification ??
    classifyCase({
      immigrationSituation: lead.immigrationSituation,
      overstayReason: lead.overstayReason,
      hasSupportingDocuments: lead.hasSupportingDocuments,
    }).category;

  const fc = lead.funnelContext ?? null;

  return {
    applicant: {
      firstName,
      lastName,
      nationality: lead.nationality ?? null,
      dateOfBirth: null,
      passportNumber: null,
    },
    contact: {
      email: lead.email ?? null,
      phone: lead.whatsapp ?? null,
      preferredContactMethod: lead.preferredContactMethod ?? null,
    },
    assessment: {
      countryOfResidence: lead.countryOfResidence ?? null,
      destination: null,
      currentlyInSouthAfrica: lead.currentlyInSouthAfrica ?? null,
      immigrationSituation: lead.immigrationSituation ?? null,
      passportStatus: lead.passportStatus ?? null,
      visaHistory: lead.visaHistory ?? null,
      visaExpiryDate: lead.visaExpiryDate ?? null,
      exitDate: lead.exitDate ?? null,
      borderDocumentIssued: lead.borderDocumentIssued ?? null,
      overstayReason: lead.overstayReason ?? null,
      previousOverstay: lead.previousOverstay ?? null,
      hasSupportingDocuments: lead.hasSupportingDocuments ?? null,
      urgency: preview.urgency ?? null,
    },
    funnelContext: {
      route: fc?.route ?? null,
      theme: fc?.theme ?? null,
      attribution: {
        source: lead.source ?? null,
        sourceCampaign: lead.sourceCampaign ?? null,
        landingPage: fc?.landingPage ?? null,
        referrer: fc?.referrer ?? null,
        utmSource: fc?.utm_source ?? null,
        utmMedium: fc?.utm_medium ?? null,
        utmCampaign: fc?.utm_campaign ?? null,
        utmContent: fc?.utm_content ?? null,
        utmTerm: fc?.utm_term ?? null,
      },
    },
    route: {
      matterType: lead.inquiryType ?? null,
      matterTypeLabel: preview.matterType ?? null,
      leadCategory,
      internalClassification,
    },
    workflowCandidate: deriveWorkflowCandidate(lead),
    operational: {
      assignedConsultantId: lead.assignedTo ?? null,
      leadStatus: lead.leadStatus ?? null,
      leadPriority: lead.leadPriority ?? null,
      internalNotes: lead.adminNotes ?? null,
      tags: lead.tags ?? null,
    },
    source: {
      leadId: lead.id,
      leadType: lead.leadType,
      referenceNumber: lead.referenceNumber,
    },
  };
}

// ---------------------------------------------------------------------------
// Field catalogue — drives the preview sections + missing-data detection
// ---------------------------------------------------------------------------

type FieldSpec = {
  key: string;
  label: string;
  section: ConversionSectionKey;
  requirement: FieldRequirement;
  /** Extract the (already-mapped) value as a string, or null if absent. */
  get: (a: ApplicationCreateRequest) => string | null;
};

/** Render assorted primitives as a display string; null stays null. */
function render(v: string | boolean | string[] | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/**
 * The catalogue is the authoritative list of what a conversion inspects and
 * how strongly each field is needed. Ordering here is the render order within
 * each section.
 */
const FIELD_CATALOGUE: FieldSpec[] = [
  // Applicant details
  {
    key: "applicant.firstName",
    label: "First name",
    section: "applicant",
    requirement: "required",
    get: (a) => render(a.applicant.firstName),
  },
  {
    key: "applicant.lastName",
    label: "Last name",
    section: "applicant",
    requirement: "required",
    get: (a) => render(a.applicant.lastName),
  },
  {
    key: "applicant.nationality",
    label: "Nationality",
    section: "applicant",
    requirement: "optional",
    get: (a) => render(a.applicant.nationality),
  },
  {
    key: "applicant.dateOfBirth",
    label: "Date of birth",
    section: "applicant",
    requirement: "manual",
    get: (a) => render(a.applicant.dateOfBirth),
  },
  {
    key: "applicant.passportNumber",
    label: "Passport number",
    section: "applicant",
    requirement: "manual",
    get: (a) => render(a.applicant.passportNumber),
  },
  // Contact details
  {
    key: "contact.reachable",
    label: "Reachable contact (email or phone)",
    section: "contact",
    requirement: "required",
    // Normalise each channel INDEPENDENTLY before the OR — a `??` on the raw
    // values would let an empty-string email shadow a perfectly valid phone.
    get: (a) => render(a.contact.email) ?? render(a.contact.phone),
  },
  {
    key: "contact.email",
    label: "Email",
    section: "contact",
    requirement: "optional",
    get: (a) => render(a.contact.email),
  },
  {
    key: "contact.phone",
    label: "Phone / WhatsApp",
    section: "contact",
    requirement: "optional",
    get: (a) => render(a.contact.phone),
  },
  {
    key: "contact.preferredContactMethod",
    label: "Preferred contact method",
    section: "contact",
    requirement: "optional",
    get: (a) => render(a.contact.preferredContactMethod),
  },
  // Assessment answers
  {
    key: "assessment.countryOfResidence",
    label: "Country of residence",
    section: "assessment",
    requirement: "required",
    get: (a) => render(a.assessment.countryOfResidence),
  },
  {
    key: "assessment.destination",
    label: "Intended destination",
    section: "assessment",
    requirement: "manual",
    get: (a) => render(a.assessment.destination),
  },
  {
    key: "assessment.immigrationSituation",
    label: "Immigration situation",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.immigrationSituation),
  },
  {
    key: "assessment.urgency",
    label: "Urgency",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.urgency),
  },
  {
    key: "assessment.currentlyInSouthAfrica",
    label: "Currently in South Africa",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.currentlyInSouthAfrica),
  },
  {
    key: "assessment.passportStatus",
    label: "Passport status",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.passportStatus),
  },
  {
    key: "assessment.visaHistory",
    label: "Visa history",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.visaHistory),
  },
  {
    key: "assessment.visaExpiryDate",
    label: "Visa expiry date",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.visaExpiryDate),
  },
  {
    key: "assessment.exitDate",
    label: "Exit date",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.exitDate),
  },
  {
    key: "assessment.borderDocumentIssued",
    label: "Border document issued",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.borderDocumentIssued),
  },
  {
    key: "assessment.overstayReason",
    label: "Overstay reason",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.overstayReason),
  },
  {
    key: "assessment.previousOverstay",
    label: "Previous overstay",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.previousOverstay),
  },
  {
    key: "assessment.hasSupportingDocuments",
    label: "Supporting documents",
    section: "assessment",
    requirement: "optional",
    get: (a) => render(a.assessment.hasSupportingDocuments),
  },
  // Funnel context
  {
    key: "funnelContext.route",
    label: "Funnel route",
    section: "funnelContext",
    requirement: "optional",
    get: (a) => render(a.funnelContext.route),
  },
  {
    key: "funnelContext.theme",
    label: "Funnel theme",
    section: "funnelContext",
    requirement: "optional",
    get: (a) => render(a.funnelContext.theme),
  },
  {
    key: "funnelContext.attribution.source",
    label: "Source",
    section: "funnelContext",
    requirement: "optional",
    get: (a) => render(a.funnelContext.attribution.source),
  },
  {
    key: "funnelContext.attribution.sourceCampaign",
    label: "Source campaign",
    section: "funnelContext",
    requirement: "optional",
    get: (a) => render(a.funnelContext.attribution.sourceCampaign),
  },
  // Route / matter classification
  {
    key: "route.matterType",
    label: "Matter type",
    section: "route",
    requirement: "required",
    get: (a) => render(a.route.matterType),
  },
  {
    key: "route.matterTypeLabel",
    label: "Matter type (label)",
    section: "route",
    requirement: "optional",
    get: (a) => render(a.route.matterTypeLabel),
  },
  {
    key: "route.leadCategory",
    label: "Lead category",
    section: "route",
    requirement: "optional",
    get: (a) => render(a.route.leadCategory),
  },
  {
    key: "route.internalClassification",
    label: "Internal classification",
    section: "route",
    requirement: "optional",
    get: (a) => render(a.route.internalClassification),
  },
  // Workflow candidate
  {
    key: "workflowCandidate.key",
    label: "Candidate workflow",
    section: "workflowCandidate",
    requirement: "required",
    get: (a) => render(a.workflowCandidate.label ?? a.workflowCandidate.key),
  },
  // Operational
  {
    key: "operational.assignedConsultantId",
    label: "Assigned consultant",
    section: "operational",
    requirement: "optional",
    get: (a) => render(a.operational.assignedConsultantId),
  },
  {
    key: "operational.leadStatus",
    label: "Lead status",
    section: "operational",
    requirement: "optional",
    get: (a) => render(a.operational.leadStatus),
  },
  {
    key: "operational.leadPriority",
    label: "Lead priority",
    section: "operational",
    requirement: "optional",
    get: (a) => render(a.operational.leadPriority),
  },
  {
    key: "operational.internalNotes",
    label: "Internal notes",
    section: "operational",
    requirement: "optional",
    get: (a) => render(a.operational.internalNotes),
  },
  {
    key: "operational.tags",
    label: "Tags",
    section: "operational",
    requirement: "optional",
    get: (a) => render(a.operational.tags),
  },
];

const SECTION_TITLES: Record<ConversionSectionKey, string> = {
  applicant: "Applicant Details",
  contact: "Contact Details",
  assessment: "Assessment Answers",
  funnelContext: "Funnel Context",
  route: "Route",
  workflowCandidate: "Workflow Candidate",
  operational: "Operational",
};

const SECTION_ORDER: ConversionSectionKey[] = [
  "applicant",
  "contact",
  "assessment",
  "funnelContext",
  "route",
  "workflowCandidate",
  "operational",
];

// ---------------------------------------------------------------------------
// Preview builder — the public entry point
// ---------------------------------------------------------------------------

/**
 * Inspect a lead and produce the full conversion preview: the mapped
 * application, per-section field breakdown, and missing-data readiness. Pure —
 * no writes, no network. This is the foundation the real "Convert to EMA
 * Application" action (a later phase) will build on.
 */
export function buildConversionPreview(lead: PrelaunchLead): ConversionPreview {
  const application = mapLeadToApplication(lead);

  const fields: ConversionField[] = FIELD_CATALOGUE.map((spec) => {
    const value = spec.get(application);
    return {
      key: spec.key,
      label: spec.label,
      requirement: spec.requirement,
      availability: value === null ? "missing" : "available",
      value,
    };
  });

  const sections: ConversionSection[] = SECTION_ORDER.map((sectionKey) => {
    const sectionFields = fields.filter(
      (_, i) => FIELD_CATALOGUE[i]!.section === sectionKey,
    );
    const complete = sectionFields
      .filter((f) => f.requirement === "required")
      .every((f) => f.availability === "available");
    return {
      key: sectionKey,
      title: SECTION_TITLES[sectionKey],
      complete,
      fields: sectionFields,
    };
  });

  const requiredAvailable: string[] = [];
  const requiredMissing: string[] = [];
  const manualCompletion: string[] = [];
  const optionalAvailable: string[] = [];
  const optionalMissing: string[] = [];
  for (const f of fields) {
    if (f.requirement === "required") {
      (f.availability === "available"
        ? requiredAvailable
        : requiredMissing
      ).push(f.key);
    } else if (f.requirement === "manual") {
      // A manual field always needs attention in EMA, whether or not the funnel
      // happened to capture a value. Report it in its own bucket.
      manualCompletion.push(f.key);
    } else {
      (f.availability === "available"
        ? optionalAvailable
        : optionalMissing
      ).push(f.key);
    }
  }

  const readiness: ConversionReadiness = {
    canConvert: requiredMissing.length === 0,
    requiredAvailable,
    requiredMissing,
    manualCompletion,
    optionalAvailable,
    optionalMissing,
  };

  return {
    leadId: lead.id,
    referenceNumber: lead.referenceNumber,
    generatedAt: new Date().toISOString(),
    application,
    sections,
    workflowCandidate: application.workflowCandidate,
    readiness,
    auditDescriptor: buildAuditDescriptor(lead, application, readiness),
  };
}

/**
 * Build the audit payload a FUTURE phase can write when a conversion preview is
 * generated. This module never writes it — Phase 12A is preparation only.
 */
function buildAuditDescriptor(
  lead: PrelaunchLead,
  application: ApplicationCreateRequest,
  readiness: ConversionReadiness,
): ConversionAuditDescriptor {
  return {
    action: "lead_conversion_previewed",
    leadId: lead.id,
    after: {
      referenceNumber: lead.referenceNumber,
      canConvert: readiness.canConvert,
      requiredMissing: readiness.requiredMissing,
      manualCompletion: readiness.manualCompletion,
      workflowCandidate: application.workflowCandidate.key,
    },
  };
}
