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

export type LeadPriority = "HIGH_PRIORITY" | "MEDIUM_PRIORITY" | "LOW_PRIORITY";

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

export function derivePriority(score: number | null | undefined): LeadPriority {
  const s = typeof score === "number" ? score : 0;
  if (s >= 80) return "HIGH_PRIORITY";
  if (s >= 60) return "MEDIUM_PRIORITY";
  return "LOW_PRIORITY";
}

export const LEAD_STATUS_VALUES = [
  "NEW",
  "REVIEWED",
  "NEEDS_FOLLOW_UP",
  "WAITLISTED",
  "NOT_RELEVANT",
] as const;
export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];

export function generateReferenceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMA-${ts}-${rand}`;
}
