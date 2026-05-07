export interface ClassificationInput {
  immigrationSituation?: string | null;
  overstayReason?: string | null;
  hasSupportingDocuments?: string | null;
}

export interface ClassificationResult {
  category: string;
  score: number;
  label: string;
}

export type LeadPriority = "critical" | "high" | "medium" | "low";

// ── CRM Phase A: dual-lead architecture enums ────────────────────────────────
// Source of truth for the discriminator and supporting taxonomies. Server-side
// validators and the OpenAPI spec both reference these via re-export.
export const LEAD_TYPE_VALUES = ["individual", "professional"] as const;
export type LeadType = (typeof LEAD_TYPE_VALUES)[number];

export const INQUIRY_TYPE_VALUES = [
  "visa_inquiry",
  "overstay_appeal",
  "travel_entry_assistance",
] as const;
export type InquiryType = (typeof INQUIRY_TYPE_VALUES)[number];

export const ORGANIZATION_TYPE_VALUES = [
  "law_firm",
  "immigration_consultancy",
  "global_mobility",
  "independent_practitioner",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPE_VALUES)[number];

export const ADMIN_ROLE_VALUES = [
  "superadmin",
  "admin",
  "sales",
  "operations",
  "viewer",
] as const;
export type AdminRole = (typeof ADMIN_ROLE_VALUES)[number];
// `LeadStatus` is exported below, derived from `LEAD_STATUS_VALUES` so the
// type and the runtime allowlist can never drift.

const STRONG_CONTEXT_REASONS = new Set([
  "medical",
  "accident",
  "family_emergency",
  "admin_delay",
]);

export function classifyCase(input: ClassificationInput): ClassificationResult {
  const { immigrationSituation, overstayReason, hasSupportingDocuments } = input;

  if (immigrationSituation === "valid") {
    return {
      category: "VALID_STATUS_GENERAL_INTEREST",
      score: 30,
      label: "General Status Check",
    };
  }

  if (immigrationSituation === "expired") {
    return {
      category: "VISA_EXPIRING_OR_EXPIRED",
      score: 55,
      label: "Visa Expiry Needs Review",
    };
  }

  if (immigrationSituation === "overstay") {
    if (
      overstayReason &&
      STRONG_CONTEXT_REASONS.has(overstayReason) &&
      hasSupportingDocuments === "yes"
    ) {
      return {
        category: "OVERSTAY_STRONG_CONTEXT",
        score: 85,
        label: "Supporting Circumstances Present",
      };
    }

    if (hasSupportingDocuments === "some") {
      return {
        category: "OVERSTAY_MODERATE_CONTEXT",
        score: 70,
        label: "Partial Supporting Context",
      };
    }

    return {
      category: "OVERSTAY_LIMITED_CONTEXT",
      score: 50,
      label: "Limited Supporting Context",
    };
  }

  if (immigrationSituation === "undesirable") {
    return {
      category: "DECLARED_UNDESIRABLE",
      score: 90,
      label: "Declared Undesirable Status",
    };
  }

  if (immigrationSituation === "prohibited") {
    return {
      category: "POSSIBLE_PROHIBITED_PERSON",
      score: 95,
      label: "Potential Prohibited Status",
    };
  }

  return {
    category: "UNKNOWN_REQUIRES_REVIEW",
    score: 60,
    label: "Further Review Required",
  };
}

/**
 * Auto-priority for newly captured leads.  An admin can always override the
 * stored priority via PATCH /api/admin/leads/:id; this function only seeds
 * the initial value at insert time.
 *
 * Rules (from product spec):
 *   - overstay-class situation OR visaHistory mentions "appeal" → high
 *   - visaHistory mentions "work" or "business"                  → medium
 *   - everything else                                            → low
 *
 * "overstay-class" is interpreted broadly to include the objectively-urgent
 * declared statuses (overstay, undesirable, prohibited) so the auto-priority
 * never silently downgrades a high-risk case to "low".
 */
export function deriveAutoPriority(
  immigrationSituation: string | null | undefined,
  visaHistory: string | null | undefined,
): LeadPriority {
  const sit = (immigrationSituation ?? "").toLowerCase();
  const vh = (visaHistory ?? "").toLowerCase();

  if (
    sit === "overstay" ||
    sit === "undesirable" ||
    sit === "prohibited" ||
    vh.includes("appeal")
  ) {
    return "high";
  }
  if (vh.includes("work") || vh.includes("business")) {
    return "medium";
  }
  return "low";
}

// Canonical lead-status enum AND funnel order.  The array order is the
// forward-only progression operators must follow:
//   new → reviewing → contacted → awaiting_response → engaged → qualified
//       → proposal_sent → ready_for_case → converted → closed
//
// `ready_for_case` (V2) sits between "qualified" and "converted":
// "all checks passed, awaiting handover".
//
// CRM Phase A added `awaiting_response`, `engaged`, and `proposal_sent` to
// match the SaaS-CRM funnel from the platform brief. The new statuses are
// inserted such that every previously-valid transition remains monotonic
// (no existing flow becomes a "regression").
//
// Funnel-regression guard: every status PATCH is validated against this
// order (see `canAdvanceStatus` + the PATCH /api/admin/leads/:id route).
export const LEAD_STATUS_VALUES = [
  "new",
  "reviewing",
  "contacted",
  "awaiting_response",
  "engaged",
  "qualified",
  "proposal_sent",
  "ready_for_case",
  "converted",
  "closed",
] as const;

export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];

/**
 * Forward-only transition guard.  Returns true when moving from `from` to
 * `to` is either a no-op (same status) or a forward step in the funnel.
 *
 * Permissive on unknown values so legacy/unrecognised statuses in the DB
 * never accidentally lock a lead — the value-allowlist check in the route
 * still rejects unknown TARGET statuses before this guard runs.
 */
export function canAdvanceStatus(
  from: string | null | undefined,
  to: string,
): boolean {
  const fromIdx = from ? LEAD_STATUS_VALUES.indexOf(from as LeadStatus) : -1;
  const toIdx = LEAD_STATUS_VALUES.indexOf(to as LeadStatus);
  if (fromIdx === -1 || toIdx === -1) return true;
  return toIdx >= fromIdx;
}

/**
 * Conversion-funnel hint shown to operators in the dashboard.  Pure derivation
 * from `leadStatus` — there is no separate `nextStep` column in the database;
 * the value is computed on read so it always reflects the current status.
 *
 * Returns `null` for `closed` (and any unknown status) so the UI can render an
 * empty cell rather than a misleading suggestion for terminal/unknown rows.
 */
const NEXT_STEP_BY_STATUS: Record<string, string> = {
  new: "Review lead",
  reviewing: "Contact lead",
  contacted: "Await response",
  awaiting_response: "Follow up",
  engaged: "Qualify lead",
  qualified: "Send proposal",
  proposal_sent: "Prepare case conversion",
  ready_for_case: "Initiate case handover",
  converted: "Move to case system",
};

export function deriveNextStep(
  status: string | null | undefined,
): string | null {
  if (!status) return null;
  return NEXT_STEP_BY_STATUS[status] ?? null;
}

// CRM Phase A: `critical` slotted ABOVE `high` for visual urgency badges.
// All historical rows default to "medium" (DB default unchanged).
export const LEAD_PRIORITY_VALUES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export function generateReferenceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMA-${ts}-${rand}`;
}
