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

export type LeadPriority = "high" | "medium" | "low";
export type LeadStatus =
  | "new"
  | "reviewing"
  | "contacted"
  | "converted"
  | "closed";

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

export const LEAD_STATUS_VALUES = [
  "new",
  "reviewing",
  "contacted",
  "converted",
  "closed",
] as const;

export const LEAD_PRIORITY_VALUES = ["high", "medium", "low"] as const;

export function generateReferenceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMA-${ts}-${rand}`;
}
