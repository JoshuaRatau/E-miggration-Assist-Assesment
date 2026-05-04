export interface ScoringInput {
  immigrationSituation?: string | null;
  passportStatus?: string | null;
  hasSupportingDocuments?: string | null;
  previousOverstay?: string | null;
  currentlyInSouthAfrica?: boolean | null;
  visaExpiryDate?: string | null;
}

export interface ScoringResult {
  leadScore: number;
  leadCategory: string;
  internalClassification: string;
}

export function classifyLead(input: ScoringInput): ScoringResult {
  let score = 50;

  switch (input.immigrationSituation) {
    case "visa_holder":
      score += 25;
      break;
    case "first_time":
      score += 15;
      break;
    case "overstayed":
      score -= 10;
      break;
    case "rejected":
      score -= 15;
      break;
    case "undocumented":
      score -= 20;
      break;
  }

  switch (input.passportStatus) {
    case "valid":
      score += 15;
      break;
    case "expired":
      score -= 5;
      break;
    case "lost":
      score -= 15;
      break;
    case "none":
      score -= 20;
      break;
  }

  switch (input.hasSupportingDocuments) {
    case "yes":
      score += 15;
      break;
    case "partial":
      score += 5;
      break;
    case "no":
      score -= 10;
      break;
  }

  if (input.previousOverstay === "yes") score -= 10;

  if (input.visaExpiryDate) {
    const expiry = new Date(input.visaExpiryDate);
    const now = new Date();
    if (!Number.isNaN(expiry.getTime())) {
      const daysUntil = Math.floor(
        (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysUntil < 0) score -= 10;
      else if (daysUntil < 30) score += 5;
    }
  }

  score = Math.max(0, Math.min(100, score));

  let leadCategory: string;
  let internalClassification: string;

  if (score >= 75) {
    leadCategory = "Strong Candidate";
    internalClassification = "tier_a_priority";
  } else if (score >= 55) {
    leadCategory = "Good Standing";
    internalClassification = "tier_b_standard";
  } else if (score >= 35) {
    leadCategory = "Needs Review";
    internalClassification = "tier_c_complex";
  } else {
    leadCategory = "High Complexity";
    internalClassification = "tier_d_specialist";
  }

  return { leadScore: score, leadCategory, internalClassification };
}

export function generateReferenceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMA-${ts}-${rand}`;
}
