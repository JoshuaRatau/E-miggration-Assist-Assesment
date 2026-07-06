import type { Lead } from "@workspace/api-client-react";

import { deriveLeadScore } from "./leadScore";

// ---------------------------------------------------------------------------
// Lead Intelligence Dashboard v2 — segment + KPI derivation.
//
// Phase 1 introduces a 4-way operator segment (All / Individual / Overstay /
// Business) derived ENTIRELY from fields already on the serialized lead
// payload — no schema change, no migration. The server only knows
// leadType ∈ {individual, professional}; the Overstay split is a client-side
// sub-filter of individuals based on the server's `leadCategory` rollup
// (with an `immigrationSituation` fallback for older rows).
// ---------------------------------------------------------------------------

export type LeadSegment = "all" | "individual" | "overstay" | "business";

/** Brand palette (see admin_mockup_v2). */
export const BRAND = {
  royal: "#2764F0",
  navy: "#0B1F4D",
} as const;

// immigration_situation enum values that roll up to the "overstay risk"
// segment when the server-side `leadCategory` rollup is absent on a row.
const OVERSTAY_SITUATIONS = new Set([
  "overstay",
  "undesirable",
  "prohibited",
  "expired",
]);

/** True for an individual lead whose situation rolls up to overstay risk. */
export function isOverstayLead(lead: Lead): boolean {
  if (lead.leadType === "professional") return false;
  const category = (lead.leadCategory ?? "").toLowerCase();
  if (category === "overstay") return true;
  const situation = (lead.immigrationSituation ?? "").toLowerCase();
  return OVERSTAY_SITUATIONS.has(situation);
}

/** The concrete segment a lead belongs to (never "all"). */
export function segmentOfLead(
  lead: Lead,
): "individual" | "overstay" | "business" {
  if (lead.leadType === "professional") return "business";
  return isOverstayLead(lead) ? "overstay" : "individual";
}

export function leadMatchesSegment(lead: Lead, segment: LeadSegment): boolean {
  if (segment === "all") return true;
  return segmentOfLead(lead) === segment;
}

/**
 * Map the 4-way UI segment onto the server's `leadType` filter param.
 * Individual + Overstay both fetch individuals; Overstay is narrowed
 * client-side afterwards.
 */
export function serverLeadTypeFor(
  segment: LeadSegment,
): "ALL" | "individual" | "professional" {
  if (segment === "business") return "professional";
  if (segment === "all") return "ALL";
  return "individual";
}

// ---------------------------------------------------------------------------
// KPI strip — Overdue SLA / Hot / New Today / In Progress.
// All derived from already-fetched fields; no extra endpoint.
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  overdueSla: number;
  hot: number;
  newToday: number;
  inProgress: number;
}

const IN_PROGRESS_STATUSES = new Set([
  "reviewing",
  "needs_more_information",
  "contacted",
  "engaged",
  "qualified",
  "proposal_sent",
  "ready_for_case",
]);

const TERMINAL_STATUSES = new Set(["converted", "closed"]);

export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** A lead whose follow-up is in the past and isn't terminal. */
export function isOverdueSla(lead: Lead, now: Date = new Date()): boolean {
  if (!lead.nextFollowUpAt) return false;
  if (TERMINAL_STATUSES.has(lead.leadStatus)) return false;
  const due = new Date(lead.nextFollowUpAt).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

/** A "hot" lead = top composite score grade (A) from deriveLeadScore. */
export function isHotLead(lead: Lead, now: Date = new Date()): boolean {
  return deriveLeadScore(lead, now).grade === "A";
}

export function computeKpis(
  leads: readonly Lead[],
  now: Date = new Date(),
): DashboardKpis {
  const today = startOfToday(now).getTime();
  const kpis: DashboardKpis = {
    overdueSla: 0,
    hot: 0,
    newToday: 0,
    inProgress: 0,
  };
  for (const lead of leads) {
    if (isOverdueSla(lead, now)) kpis.overdueSla++;
    if (isHotLead(lead, now)) kpis.hot++;
    const created = new Date(lead.createdAt).getTime();
    if (!Number.isNaN(created) && created >= today) kpis.newToday++;
    if (IN_PROGRESS_STATUSES.has(lead.leadStatus)) kpis.inProgress++;
  }
  return kpis;
}

// ---------------------------------------------------------------------------
// Segment counts for the toggle pills.
// ---------------------------------------------------------------------------

export interface SegmentCounts {
  all: number;
  individual: number;
  overstay: number;
  business: number;
}

export function computeSegmentCounts(leads: readonly Lead[]): SegmentCounts {
  const counts: SegmentCounts = {
    all: leads.length,
    individual: 0,
    overstay: 0,
    business: 0,
  };
  for (const lead of leads) {
    const segment = segmentOfLead(lead);
    if (segment === "business") counts.business++;
    else if (segment === "overstay") counts.overstay++;
    else counts.individual++;
  }
  return counts;
}

/**
 * Unassigned, critical-priority overstay leads — the population that drives
 * the critical-overstay alert banner. Phase 1 surfaces these in the UI only;
 * automated escalation (Telegram etc.) lands in a later phase.
 */
export function criticalOverstayLeads(leads: readonly Lead[]): Lead[] {
  return leads.filter(
    (lead) =>
      isOverstayLead(lead) &&
      lead.leadPriority === "critical" &&
      !lead.assignedTo &&
      !TERMINAL_STATUSES.has(lead.leadStatus),
  );
}
