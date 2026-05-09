/**
 * Phase 6B — Pure score computation.
 *
 * Given a list of `lead_events` and a `Rubric`, return the total score
 * (clamped to the rubric cap) and a breakdown suitable for the UI tooltip.
 *
 * Pure function — no DB, no I/O. The worker handles persistence; this
 * module is unit-testable in isolation.
 *
 * Per-rule semantics
 * ------------------
 *   - Events of the same `type` are sorted newest-first; only the first
 *     `maxOccurrences` (default Infinity) contribute.
 *   - If `decayDays` is set on the rule, each contributing event's points
 *     are scaled by `max(0, 1 - ageDays/decayDays)`.
 *   - The rule's contribution is the sum of contributing events' (decayed)
 *     points.
 *   - The total across rules is rounded to int and clamped to `[0, cap]`.
 *
 * The breakdown lists ONE entry per rule that contributed a non-zero
 * value, sorted by points-contributed descending so the tooltip leads
 * with the most influential signals.
 */

import type { LeadEvent } from "@workspace/db";
import type { Rubric } from "./scoringRubrics";

export interface BreakdownEntry {
  rule: string;
  points: number;
  occurrences: number;
}

export interface ComputeResult {
  total: number;
  breakdown: BreakdownEntry[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeScore(
  events: LeadEvent[],
  rubric: Rubric,
  now: Date = new Date(),
): ComputeResult {
  const breakdown: BreakdownEntry[] = [];
  let total = 0;

  for (const rule of rubric.rules) {
    const matching = events
      .filter((e) => e.type === rule.type)
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      );

    if (matching.length === 0) continue;

    const cap = rule.maxOccurrences ?? Number.POSITIVE_INFINITY;
    const contributors = matching.slice(0, cap);

    let ruleTotal = 0;
    for (const e of contributors) {
      const basePoints = e.points;
      if (basePoints === 0) continue;
      let scaled = basePoints;
      if (rule.decayDays && rule.decayDays > 0) {
        const ageDays =
          (now.getTime() - new Date(e.occurredAt).getTime()) / MS_PER_DAY;
        const factor = Math.max(0, 1 - ageDays / rule.decayDays);
        scaled = basePoints * factor;
      }
      ruleTotal += scaled;
    }

    if (ruleTotal === 0) continue;

    // NOTE: rounding is deferred until after the per-rule totals have
    // been summed so that small fractional contributions across many
    // rules don't drift the breakdown vs the headline total.
    breakdown.push({
      rule: rule.type,
      points: ruleTotal,
      occurrences: contributors.length,
    });
    total += ruleTotal;
  }

  // Round once at the end. Breakdown points are rounded individually so
  // that the sum-of-breakdown == headline-total invariant holds modulo
  // standard half-up rounding; the headline is the sum of the rounded
  // breakdown values, then clamped.
  for (const b of breakdown) {
    b.points = Math.round(b.points);
  }
  const summed = breakdown.reduce((acc, b) => acc + b.points, 0);
  const clamped = Math.max(0, Math.min(rubric.cap, summed));
  breakdown.sort((a, b) => b.points - a.points);
  return { total: clamped, breakdown };
}
