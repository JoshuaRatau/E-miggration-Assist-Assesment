type EventName =
  | "assessment_started"
  | "assessment_completed"
  | "classification_result"
  | "document_upload"
  | "lead.whatsapp_captured"
  // Conversion Engine V1: admin clicked the per-row "Contact" quick-action
  // on /admin.  Payload: { leadId, channel: "whatsapp" | "email" }.
  | "lead_contact_clicked"
  // Milestone 2 — Funnel Intelligence (Phase 9): lightweight funnel analytics.
  // Purely additive telemetry — no flow, questionnaire, or submission changes.
  | "funnel_route_selected"
  | "funnel_assessment_started"
  | "funnel_lead_submitted"
  | "reference_lookup_started";

import { apiUrl } from "./apiBase";

const ENDPOINT = apiUrl("/api/analytics/events");

export function trackEvent(
  eventName: EventName,
  options?: { referenceNumber?: string; payload?: Record<string, unknown> },
): void {
  // Fire-and-forget; never block UI on analytics failures
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventName,
      referenceNumber: options?.referenceNumber,
      payload: options?.payload,
    }),
    keepalive: true,
  }).catch(() => {
    // ignored
  });
}
