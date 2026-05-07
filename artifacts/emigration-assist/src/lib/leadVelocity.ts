import type { Lead } from "@workspace/api-client-react";

// One-stop "what's the operator-relevant urgency on this lead right now?"
// derivation. Pure & data-only — the consuming UI decides how to render it.
//
// Inputs come straight off AdminLeadListItem (createdAt, lastContactedAt,
// nextFollowUpAt, leadStatus). The result drives the velocity chip on
// table rows and pipeline cards, and will later feed a "Needs attention"
// quick-filter on the dashboard.
//
// State priority (highest urgency first — first match wins):
//   overdue   — nextFollowUpAt set and already in the past
//   due_soon  — nextFollowUpAt set and within the next 24h
//   stale     — active funnel + last touch > 7 days ago (or never, with
//               createdAt > 5d) — i.e. the lead is going cold
//   fresh     — created in the last 24h, not yet contacted
//   null      — none of the above (calm state, no chip rendered)
//
// "Active funnel" excludes terminal statuses (converted, closed) so we
// don't shout "stale!" at leads the operator has already wrapped up.

export type LeadVelocityState = "overdue" | "due_soon" | "stale" | "fresh";

export interface LeadVelocity {
  state: LeadVelocityState;
  // Short label, e.g. "Overdue 2d", "Due in 4h", "Stale 9d", "New".
  label: string;
  // Tailwind class set for the chip (text + border + bg). Kept in this
  // helper so both row and card surfaces stay visually consistent.
  className: string;
  // Longer human description used as the chip's title/tooltip.
  tooltip: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const TERMINAL_STATUSES = new Set(["converted", "closed"]);

function fmtDuration(ms: number): { value: number; unit: "h" | "d" } {
  const abs = Math.abs(ms);
  if (abs < DAY_MS) {
    // Round up so "in 30m" still reads as "1h" rather than "0h"; for past
    // durations Math.max guards against the same 0h floor.
    return { value: Math.max(1, Math.ceil(abs / HOUR_MS)), unit: "h" };
  }
  return { value: Math.max(1, Math.floor(abs / DAY_MS)), unit: "d" };
}

export function deriveLeadVelocity(
  lead: Pick<
    Lead,
    "createdAt" | "lastContactedAt" | "nextFollowUpAt" | "leadStatus"
  >,
  now: Date = new Date(),
): LeadVelocity | null {
  const nowMs = now.getTime();
  const nextFollowUp = lead.nextFollowUpAt
    ? new Date(lead.nextFollowUpAt).getTime()
    : null;

  // 1. Overdue — explicit follow-up time has passed. Highest urgency
  //    because the operator made an explicit promise to themselves.
  if (nextFollowUp !== null && nextFollowUp < nowMs) {
    const { value, unit } = fmtDuration(nowMs - nextFollowUp);
    return {
      state: "overdue",
      label: `Overdue ${value}${unit}`,
      className:
        "border-red-500/60 bg-red-500/10 text-red-300 hover:bg-red-500/15",
      tooltip: `Follow-up was scheduled ${value}${unit} ago and hasn't been actioned`,
    };
  }

  // 2. Due soon — explicit follow-up within the next 24h.
  if (nextFollowUp !== null && nextFollowUp - nowMs <= DAY_MS) {
    const { value, unit } = fmtDuration(nextFollowUp - nowMs);
    return {
      state: "due_soon",
      label: `Due in ${value}${unit}`,
      className:
        "border-amber-500/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15",
      tooltip: `Scheduled follow-up coming up in ${value}${unit}`,
    };
  }

  const status = lead.leadStatus ?? "new";
  const isActive = !TERMINAL_STATUSES.has(status);

  if (isActive) {
    const lastContactMs = lead.lastContactedAt
      ? new Date(lead.lastContactedAt).getTime()
      : null;
    const createdMs = new Date(lead.createdAt).getTime();

    // 3a. Contacted but going cold — > 7 days since last touch.
    if (lastContactMs !== null && nowMs - lastContactMs > 7 * DAY_MS) {
      const { value, unit } = fmtDuration(nowMs - lastContactMs);
      return {
        state: "stale",
        label: `Stale ${value}${unit}`,
        className:
          "border-orange-500/60 bg-orange-500/10 text-orange-300 hover:bg-orange-500/15",
        tooltip: `No contact activity for ${value}${unit}`,
      };
    }

    // 3b. Never contacted, sitting > 5 days. Active funnel = somebody
    //     should have reached out by now.
    if (lastContactMs === null && nowMs - createdMs > 5 * DAY_MS) {
      const { value, unit } = fmtDuration(nowMs - createdMs);
      return {
        state: "stale",
        label: `Untouched ${value}${unit}`,
        className:
          "border-orange-500/60 bg-orange-500/10 text-orange-300 hover:bg-orange-500/15",
        tooltip: `Captured ${value}${unit} ago and never contacted`,
      };
    }

    // 4. Fresh — created in the last 24h AND not yet contacted.
    //    Useful nudge for the morning standup ("anything new overnight
    //    that hasn't been touched?"). The lastContactMs === null guard
    //    is what differentiates this from a routine "recent" lead — a
    //    lead created an hour ago and already replied to should not
    //    keep wearing a "New" chip.
    if (lastContactMs === null && nowMs - createdMs <= DAY_MS) {
      return {
        state: "fresh",
        label: "New",
        className:
          "border-blue-500/60 bg-blue-500/10 text-blue-300 hover:bg-blue-500/15",
        tooltip: "Captured in the last 24 hours",
      };
    }
  }

  return null;
}
