import type { Flow } from "./snapshots";
/** Only the documented absent-name read shape is equivalent. No trimming,
 * case folding, prefix matching, or fallback over an explicitly returned name. */
export function standardReadbackMatches(remote: Record<string, unknown>, key: string, expected: unknown) {
  if (key === "name" && !Object.hasOwn(remote, "name")) {
    return typeof remote.firstName === "string" && typeof remote.lastName === "string" &&
      `${remote.firstName} ${remote.lastName}` === expected;
  }
  return JSON.stringify(remote[key]) === JSON.stringify(expected);
}
export type FieldDefinition = { key: string; name: string; dataType: "TEXT" | "LARGE_TEXT" | "SINGLE_OPTIONS" | "MULTIPLE_OPTIONS"; model: "contact" | "opportunity"; options?: string[] };
const field = (key: string, name: string, dataType: FieldDefinition["dataType"] = "TEXT", options?: string[]): FieldDefinition =>
  ({ key, name: `EMA ${name}`, dataType, model: "contact", ...(options ? { options } : {}) });
/** GHL deliberately removes the hyphen only for this one provider-generated key. */
export function expectedProviderFieldKey(definition: FieldDefinition) {
  return definition.model === "contact" && definition.key === "ema_whatsapp_opt_in"
    ? "contact.ema_whatsapp_optin"
    : `${definition.model}.${definition.key}`;
}
export function providerFieldKeyMatches(actual: unknown, definition: FieldDefinition) {
  const logicalKey = `${definition.model}.${definition.key}`;
  return actual === logicalKey || actual === expectedProviderFieldKey(definition);
}
// New fields only. None of the eight existing custom-field IDs is referenced.
export const fieldDefinitions: FieldDefinition[] = [
  field("ema_lead_id", "Lead ID"), field("ema_reference", "Reference"),
  field("ema_latest_submission_id", "Latest Submission ID"),
  field("ema_assessment_type", "Assessment Type", "SINGLE_OPTIONS", ["individual", "overstay", "business"]),
  field("ema_latest_completed_at", "Latest Completed At"),
  field("ema_assessment_consent", "Assessment Consent", "SINGLE_OPTIONS", ["accepted", "not-recorded"]),
  field("ema_consent_at", "Consent At"),
  field("ema_preferred_contact_channel", "Preferred Contact Channel", "SINGLE_OPTIONS", ["email", "whatsapp", "phone"]),
  field("ema_whatsapp_number", "WhatsApp Number"),
  field("ema_whatsapp_opt_in", "WhatsApp Opt-in", "SINGLE_OPTIONS", ["yes", "no", "not-recorded"]),
  field("ema_source", "Source"), field("ema_source_campaign", "Source Campaign"),
  field("ema_utm_source", "UTM Source"), field("ema_utm_medium", "UTM Medium"), field("ema_utm_campaign", "UTM Campaign"),
  field("ema_funnel_context", "Funnel Context", "LARGE_TEXT"),
  field("ema_immigration_situation", "Immigration Situation", "SINGLE_OPTIONS",
    ["valid", "expired", "overstay", "undesirable", "prohibited", "visa_required", "unknown"]),
  field("ema_overstay_situation", "Overstay Situation", "SINGLE_OPTIONS",
    ["visa_expired", "undesirable_declaration", "overstayed_after_expiry", "unsure_of_status", "application_rejected_in_sa", "missed_departure_deadline", "other"]),
  field("ema_practice_areas", "Practice Areas", "MULTIPLE_OPTIONS",
    ["work_visas", "permanent_residence", "appeals", "condonation", "corporate_mobility", "other"]),
  field("ema_annual_case_volume_band", "Annual Case Volume Band", "SINGLE_OPTIONS", ["<25", "25-99", "100-249", "250+"]),
  { ...field("ema_lead_id", "Lead ID"), model: "opportunity" },
  { ...field("ema_reference", "Reference"), model: "opportunity" },
];
export type Assessment = {
  id: string; lead_id: string; flow: Flow; answers: Record<string, any>;
  attribution: Record<string, any>; completed_at: Date | string;
};
export function customValues(s: Assessment): Record<string, unknown> {
  const a = s.answers, f = s.attribution.funnelContext;
  const values: Record<string, unknown> = {
    ema_lead_id: s.lead_id, ema_reference: a.referenceNumber,
    ema_latest_submission_id: s.id, ema_assessment_type: s.flow,
    ema_latest_completed_at: new Date(s.completed_at).toISOString(),
    ema_assessment_consent: a.consentAccepted === true ? "accepted" : "not-recorded",
    ema_consent_at: a.consentTimestamp,
    ema_preferred_contact_channel: a.preferredContactMethod ?? a.preferredChannel,
    ema_whatsapp_number: a.whatsapp || undefined,
    // Absence is omitted, not false, and does not clear a prior recorded value.
    ema_whatsapp_opt_in: typeof a.whatsappOptIn === "boolean" ? a.whatsappOptIn ? "yes" : "no" : undefined,
    ema_source: s.attribution.source,
    ema_source_campaign: s.attribution.sourceCampaign || undefined,
    ema_utm_source: f?.utm_source, ema_utm_medium: f?.utm_medium, ema_utm_campaign: f?.utm_campaign,
    ema_funnel_context: f ? JSON.stringify(f) : undefined,
    ema_immigration_situation: s.flow === "individual" ? a.immigrationSituation : undefined,
    ema_overstay_situation: s.flow === "overstay" ? a.currentSituation : undefined,
    ema_practice_areas: s.flow === "business" ? a.practiceAreas : undefined,
    ema_annual_case_volume_band: s.flow === "business" ? a.casesLast12mBand : undefined,
  };
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null));
}
export function standardValues(s: Assessment) {
  const a = s.answers;
  const phone = [a.phone, a.whatsapp].find(v => typeof v === "string" && /^\+[1-9]\d{6,14}$/.test(v.replace(/[\s()-]/g, "")));
  return Object.fromEntries(Object.entries({
    name: a.fullName, firstName: s.flow === "overstay" ? a.firstName : undefined,
    email: a.email, phone: phone?.replace(/[\s()-]/g, ""),
    companyName: a.firmName, city: a.city, state: a.provinceState,
    country: /^[A-Z]{2}$/.test(a.countryOfResidence || "") ? a.countryOfResidence : undefined,
  }).filter(([, v]) => typeof v === "string" && v.length > 0));
}
export function historyBody(s: Assessment) {
  // Immutable source only, never mutable adminNotes or private attachment URLs.
  const body = `EMA assessment [ema-submission:${s.id}]\nCompleted: ${new Date(s.completed_at).toISOString()}\nType: ${s.flow}\nReference: ${s.answers.referenceNumber}\nAnswers:\n${JSON.stringify(s.answers, null, 2)}\nCaptured attribution:\n${JSON.stringify(s.attribution, null, 2)}`;
  // Until provider limits are verified, refuse rather than truncate or create partial history.
  if (body.length > 10000) throw new Error("HISTORY_SIZE_REVIEW_REQUIRED");
  return body;
}