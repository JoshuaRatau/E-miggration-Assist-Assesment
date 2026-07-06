import type { Lead } from "@workspace/api-client-react";

import { deriveLeadVelocity } from "./leadVelocity";

// Composite operator-relevant lead score (0..100) and letter grade
// (A/B/C/D). Designed to answer "if I only have time for ten leads
// today, which ten?" — so it blends *value* (priority, B2B, funnel
// position) with *urgency* (velocity) and *engagement quality*
// (WhatsApp channel, recency of last touch).
//
// Pure & data-only: takes whatever AdminLeadListItem fields are
// available and returns a deterministic score. The component layer
// renders the result.
//
// Formula (all weights are intentionally small integers so the
// breakdown is readable and tunable):
//
//   priority      → critical 35 / high 25 / medium 15 / low 5
//   funnelStage   → new 5 / reviewing 10 / contacted 15 /
//                   engaged 20 / qualified 25 /
//                   proposal_sent 30 / ready_for_case 35 /
//                   converted 10 (already won — lower urgency to act) /
//                   closed 0
//   velocity      → uses VELOCITY_SEVERITY * 5 (overdue 20, stale 15,
//                   due_soon 10, fresh 5)
//   engagement    → +5 if hasWhatsapp / a real whatsapp string,
//                   +5 if last contacted within the past 7 days
//                   (proves the lead is responsive),
//                   +5 if leadType === 'professional' (B2B leads
//                   typically carry higher case-fee value)
//
// Score is capped at 100. Grade thresholds:
//   A ≥ 75   B ≥ 55   C ≥ 35   D < 35
//
// `breakdown` is a list of human-readable contribution lines used as
// the badge's tooltip so operators can see exactly why a lead is hot.

export type LeadGrade = "A" | "B" | "C" | "D";

export interface LeadScore {
  score: number;
  grade: LeadGrade;
  breakdown: string[];
}

const PRIORITY_WEIGHTS: Record<string, number> = {
  critical: 35,
  high: 25,
  medium: 15,
  low: 5,
};

const FUNNEL_WEIGHTS: Record<string, number> = {
  new: 5,
  reviewing: 10,
  needs_more_information: 10,
  contacted: 15,
  engaged: 20,
  qualified: 25,
  proposal_sent: 30,
  ready_for_case: 35,
  converted: 10,
  closed: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveLeadScore(
  lead: Pick<
    Lead,
    | "createdAt"
    | "lastContactedAt"
    | "nextFollowUpAt"
    | "leadStatus"
    | "leadPriority"
    | "leadType"
    | "whatsapp"
    | "hasWhatsapp"
  >,
  now: Date = new Date(),
): LeadScore {
  const breakdown: string[] = [];
  let score = 0;

  // 1) Priority
  const priority = lead.leadPriority ?? null;
  const priorityW = priority ? PRIORITY_WEIGHTS[priority] ?? 0 : 0;
  if (priorityW > 0) {
    score += priorityW;
    breakdown.push(`+${priorityW} priority (${priority})`);
  }

  // 2) Funnel stage
  const status = lead.leadStatus ?? "new";
  const funnelW = FUNNEL_WEIGHTS[status] ?? 0;
  if (funnelW > 0) {
    score += funnelW;
    breakdown.push(`+${funnelW} stage (${status})`);
  }

  // 3) Velocity (urgency multiplier × 5)
  const velocity = deriveLeadVelocity(lead, now);
  if (velocity) {
    const w = velocity.severity * 5;
    score += w;
    breakdown.push(`+${w} velocity (${velocity.state})`);
  }

  // 4) Engagement signals
  const hasWa =
    lead.hasWhatsapp ??
    (typeof lead.whatsapp === "string" && lead.whatsapp.length > 0);
  if (hasWa) {
    score += 5;
    breakdown.push("+5 has WhatsApp");
  }
  if (lead.lastContactedAt) {
    const ageMs = now.getTime() - new Date(lead.lastContactedAt).getTime();
    if (ageMs <= 7 * DAY_MS) {
      score += 5;
      breakdown.push("+5 recently contacted");
    }
  }
  if (lead.leadType === "professional") {
    score += 5;
    breakdown.push("+5 B2B lead");
  }

  // Cap & grade
  score = Math.min(100, score);
  const grade: LeadGrade =
    score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D";

  return { score, grade, breakdown };
}

// Tailwind class set per grade — kept in this helper so the badge and
// any future grade-coloured row accents stay visually consistent.
export const GRADE_CLASS: Record<LeadGrade, string> = {
  A: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300",
  B: "border-teal-500/60 bg-teal-500/15 text-teal-300",
  C: "border-amber-500/60 bg-amber-500/15 text-amber-300",
  D: "border-slate-500/50 bg-slate-500/10 text-slate-400",
};
