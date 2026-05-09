import type { Lead } from "@workspace/api-client-react";

import { Badge } from "@/components/ui/badge";
import { deriveLeadScore, GRADE_CLASS, type LeadGrade } from "@/lib/leadScore";

export interface LeadScoreBadgeProps {
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
    | "leadScore"
    | "leadScoreRubric"
    | "leadScoreBreakdown"
    | "leadScoreComputedAt"
  >;
  now?: Date;
  testIdSuffix?: string;
  className?: string;
  // Compact mode renders just the grade letter (for tight pipeline cards).
  // Default mode shows "A · 82" so the operator sees the underlying score.
  compact?: boolean;
  // Phase 6B PR 3 — render a small rubric pill ("static" / "self-serve" /
  // "sales") next to the score so operators see WHY a lead was scored
  // the way it was. Off by default to keep dense table cells uncluttered;
  // turned on by the lead-detail header.
  showRubric?: boolean;
}

// Phase 6B PR 3 — letter-grade thresholds for the worker-derived score.
// Matches `lib/leadScore.ts` so badge colours stay consistent whichever
// path produced the value.
function gradeFor(score: number): LeadGrade {
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "D";
}

const RUBRIC_LABEL: Record<string, string> = {
  self_serve: "self-serve",
  sales: "sales",
  static: "static",
};

const RUBRIC_CLASS: Record<string, string> = {
  self_serve: "border-sky-500/60 bg-sky-500/15 text-sky-300",
  sales: "border-violet-500/60 bg-violet-500/15 text-violet-300",
  static: "border-slate-500/50 bg-slate-500/10 text-slate-400",
};

/**
 * Compact lead-quality indicator: single-letter grade (A/B/C/D) plus the
 * underlying numeric score. Tooltip lists every contribution so the
 * scoring stays auditable rather than feeling like a black-box CRM.
 *
 * Phase 6B PR 3 — when the score recompute worker has populated
 * `leadScoreBreakdown` + `leadScoreRubric`, the badge prefers those
 * server-side values so the visible breakdown matches the rubric the
 * operator would see in the lead-detail Activity panel. Falls back to
 * the legacy client-side `deriveLeadScore` derivation for leads the
 * worker has not yet processed (transient state on first deploy or
 * for newly-created leads in the gap before the next 60s tick).
 */
export function LeadScoreBadge({
  lead,
  now,
  testIdSuffix,
  className,
  compact = false,
  showRubric = false,
}: LeadScoreBadgeProps) {
  const workerBreakdown = lead.leadScoreBreakdown;
  const workerRubric = lead.leadScoreRubric ?? null;
  // Server-side score is preferred whenever the worker has populated it.
  // Known gap: up to ~60s after a PATCH the server value may be stale
  // (worker tick interval). Falling back to the legacy `deriveLeadScore`
  // here would cause the badge to flicker server→legacy→server, which is
  // worse UX than the lag — accepted trade-off, see ROADMAP Phase 6B PR 4
  // which closes most of the window by emitting an event inline at PATCH.
  const useWorker =
    typeof lead.leadScore === "number" &&
    Array.isArray(workerBreakdown) &&
    !!workerRubric;

  let score: number;
  let grade: LeadGrade;
  let breakdownLines: string[];

  if (useWorker) {
    score = lead.leadScore as number;
    grade = gradeFor(score);
    breakdownLines = (workerBreakdown ?? []).map(
      (b) => `+${b.points} ${b.rule}${b.occurrences > 1 ? ` ×${b.occurrences}` : ""}`,
    );
  } else {
    const derived = deriveLeadScore(lead, now);
    score = derived.score;
    grade = derived.grade;
    breakdownLines = derived.breakdown;
  }

  const rubricSuffix = useWorker && workerRubric ? ` · rubric: ${workerRubric}` : "";
  const tooltip =
    breakdownLines.length === 0
      ? `Score ${score}/100 (no positive signals yet)${rubricSuffix}`
      : `Score ${score}/100${rubricSuffix}\n${breakdownLines.join("\n")}`;

  const badge = (
    <Badge
      variant="outline"
      title={tooltip}
      data-testid={
        testIdSuffix ? `score-badge-${testIdSuffix}` : "score-badge"
      }
      data-score={score}
      data-grade={grade}
      data-rubric={workerRubric ?? undefined}
      className={`text-[10px] py-0 px-1.5 font-semibold tabular-nums ${
        GRADE_CLASS[grade]
      } ${className ?? ""}`}
    >
      {compact ? grade : `${grade} · ${score}`}
    </Badge>
  );

  if (!showRubric || !workerRubric) return badge;

  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <Badge
        variant="outline"
        title={`Scoring rubric: ${workerRubric}. Routed from the lead's intended-tier motion.`}
        data-testid={
          testIdSuffix ? `rubric-pill-${testIdSuffix}` : "rubric-pill"
        }
        className={`text-[9px] py-0 px-1.5 uppercase tracking-wide ${
          RUBRIC_CLASS[workerRubric] ?? RUBRIC_CLASS.static
        }`}
      >
        {RUBRIC_LABEL[workerRubric] ?? workerRubric}
      </Badge>
    </span>
  );
}
