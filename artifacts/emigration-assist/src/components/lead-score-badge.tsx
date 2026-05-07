import type { Lead } from "@workspace/api-client-react";

import { Badge } from "@/components/ui/badge";
import { deriveLeadScore, GRADE_CLASS } from "@/lib/leadScore";

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
  >;
  now?: Date;
  testIdSuffix?: string;
  className?: string;
  // Compact mode renders just the grade letter (for tight pipeline cards).
  // Default mode shows "A · 82" so the operator sees the underlying score.
  compact?: boolean;
}

/**
 * Compact lead-quality indicator: single-letter grade (A/B/C/D) plus the
 * underlying numeric score. Tooltip lists every contribution so the
 * scoring stays auditable rather than feeling like a black-box CRM.
 */
export function LeadScoreBadge({
  lead,
  now,
  testIdSuffix,
  className,
  compact = false,
}: LeadScoreBadgeProps) {
  const { score, grade, breakdown } = deriveLeadScore(lead, now);
  const tooltip =
    breakdown.length === 0
      ? `Score ${score}/100 (no positive signals yet)`
      : `Score ${score}/100\n${breakdown.join("\n")}`;
  return (
    <Badge
      variant="outline"
      title={tooltip}
      data-testid={
        testIdSuffix ? `score-badge-${testIdSuffix}` : "score-badge"
      }
      data-score={score}
      data-grade={grade}
      className={`text-[10px] py-0 px-1.5 font-semibold tabular-nums ${
        GRADE_CLASS[grade]
      } ${className ?? ""}`}
    >
      {compact ? grade : `${grade} · ${score}`}
    </Badge>
  );
}
