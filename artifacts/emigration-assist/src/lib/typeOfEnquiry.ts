// "Type of Enquiry" derivation — Phase 5 §5.
//
// The legacy "Visa Type" column surfaced the lead's `immigrationSituation`
// enum verbatim (valid / expired / overstay / undesirable / prohibited /
// unknown). The Phase 5 brief broadens this into 7 operational categories
// that span both B2C (individual) and B2B (professional) leads.
//
// We derive the category from the existing schema (no new column) so the
// rename ships without a migration. Operators can still override later if
// we ever add an explicit `enquiry_category` field.
//
// Mapping rules (most specific first):
//   B2B — professional firms:
//     • estimatedClientVolume > 100   → Enterprise Demo Request
//         (organizationType is the firm's *practice* type — law_firm,
//          immigration_consultancy, global_mobility,
//          independent_practitioner — and is NOT a sizing signal, so
//          we deliberately ignore it for enterprise-vs-partnership
//          classification.)
//     • else                          → Professional Partnership
//   B2C — individual leads:
//     • inquiryType === "overstay_appeal"
//       OR immigrationSituation === "overstay"            → Overstay
//     • immigrationSituation in {"undesirable","prohibited"}
//                                                         → Declared Undesirable
//     • inquiryType === "travel_entry_assistance"         → Travel Assistance
//     • immigrationSituation in {"valid","expired"}       → Immigration Consultation
//     • immigrationSituation in {"unknown", null}         → First Time Entry
//     • fallback                                          → Immigration Consultation

export type EnquiryCategory =
  | "overstay"
  | "declared_undesirable"
  | "first_time_entry"
  | "travel_assistance"
  | "immigration_consultation"
  | "professional_partnership"
  | "enterprise_demo_request";

export const ENQUIRY_CATEGORY_LABELS: Record<EnquiryCategory, string> = {
  overstay: "Overstay",
  declared_undesirable: "Declared Undesirable",
  first_time_entry: "First Time Entry",
  travel_assistance: "Travel Assistance",
  immigration_consultation: "Immigration Consultation",
  professional_partnership: "Professional Partnership",
  enterprise_demo_request: "Enterprise Demo Request",
};

export type LeadForEnquiry = {
  leadType?: string | null;
  inquiryType?: string | null;
  immigrationSituation?: string | null;
  organizationType?: string | null;
  estimatedClientVolume?: number | null;
};

export function deriveEnquiryCategory(lead: LeadForEnquiry): EnquiryCategory {
  if (lead.leadType === "professional") {
    const volume =
      typeof lead.estimatedClientVolume === "number"
        ? lead.estimatedClientVolume
        : 0;
    if (volume > 100) return "enterprise_demo_request";
    return "professional_partnership";
  }
  const sit = lead.immigrationSituation ?? null;
  const inq = lead.inquiryType ?? null;
  if (inq === "overstay_appeal" || sit === "overstay") return "overstay";
  if (sit === "undesirable" || sit === "prohibited") {
    return "declared_undesirable";
  }
  if (inq === "travel_entry_assistance") return "travel_assistance";
  if (sit === "valid" || sit === "expired") return "immigration_consultation";
  if (sit === null || sit === "unknown") return "first_time_entry";
  return "immigration_consultation";
}

export function enquiryCategoryLabel(lead: LeadForEnquiry): string {
  return ENQUIRY_CATEGORY_LABELS[deriveEnquiryCategory(lead)];
}
