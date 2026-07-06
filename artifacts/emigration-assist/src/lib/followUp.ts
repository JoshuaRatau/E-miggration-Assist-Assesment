import type { Lead } from "@workspace/api-client-react";
import { isOverdueSla } from "./leadSegment";

// ---------------------------------------------------------------------------
// Phase 11D — follow-up / task derivation (single source of truth).
//
// The "follow-up" for a lead is the existing `nextFollowUpAt` timestamp (date +
// optional time) plus the new optional `followUpNote`. There is NO separate
// task entity and NO separate owner field — the follow-up belongs to whoever
// the lead is assigned to (`assignedTo`), derived on read so it always tracks
// the current owner.
//
// This module centralises the state machine + colour/label decode that was
// previously duplicated inline across the leads-table SLA pill and the drawer,
// so every surface (table, drawer, detail page, dashboard filter) renders an
// identical follow-up state. Colours reuse the existing SLA badge palette:
//   overdue   → amber   (🔴 in spec terms)
//   due_today → blue    (🟡)
//   upcoming  → emerald (🟢)
//   closed    → grey    (past-due but the lead is terminal — not actionable)
//   none      → grey    (no follow-up scheduled)
// ---------------------------------------------------------------------------

export type FollowUpState =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "closed"
  | "none";

/** Dashboard filter values. "all" disables the filter. */
export type FollowUpFilter =
  | "all"
  | "overdue"
  | "due_today"
  | "upcoming"
  | "none";

export interface FollowUpInfo {
  state: FollowUpState;
  dueAt: Date | null;
  note: string | null;
  /** Tailwind background class for the status dot. */
  dot: string;
  /** Human-readable status label. */
  label: string;
}

const DOT: Record<FollowUpState, string> = {
  overdue: "bg-amber-500",
  due_today: "bg-blue-500",
  upcoming: "bg-emerald-500",
  closed: "bg-muted-foreground/40",
  none: "bg-muted-foreground/40",
};

const LABEL: Record<FollowUpState, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  closed: "Closed",
  none: "Not set",
};

/**
 * Resolve the follow-up state for a lead. Mirrors the prior inline SLA logic:
 * overdue reuses `isOverdueSla` (past-due AND non-terminal); a due date that
 * falls on-or-before end-of-today (and isn't overdue) is "due today"; any
 * remaining future date is "upcoming"; a past date on a terminal lead is
 * "closed"; absent/invalid dates are "none".
 */
export function followUpState(lead: Lead, now: Date = new Date()): FollowUpState {
  const raw = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  if (!raw || Number.isNaN(raw.getTime())) return "none";
  if (isOverdueSla(lead, now)) return "overdue";
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (raw.getTime() <= endOfToday.getTime()) return "due_today";
  // Future date that isn't today → upcoming. (A past date that isn't overdue
  // means a terminal lead, handled next.)
  if (raw.getTime() >= now.getTime()) return "upcoming";
  return "closed";
}

/** Full decode: state + parsed date + note + presentation helpers. */
export function followUpInfo(lead: Lead, now: Date = new Date()): FollowUpInfo {
  const state = followUpState(lead, now);
  const raw = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const dueAt = raw && !Number.isNaN(raw.getTime()) ? raw : null;
  const note =
    typeof lead.followUpNote === "string" && lead.followUpNote.trim().length > 0
      ? lead.followUpNote
      : null;
  return { state, dueAt, note, dot: DOT[state], label: LABEL[state] };
}

/**
 * Client-side predicate for the dashboard "Follow-up" filter chip. "upcoming"
 * intentionally includes only genuinely-upcoming leads (not overdue / due
 * today); "none" matches leads with no follow-up scheduled.
 */
export function matchesFollowUpFilter(
  lead: Lead,
  filter: FollowUpFilter,
  now: Date = new Date(),
): boolean {
  if (filter === "all") return true;
  return followUpState(lead, now) === filter;
}
