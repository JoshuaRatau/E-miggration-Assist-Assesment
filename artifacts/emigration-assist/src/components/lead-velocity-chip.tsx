import type { Lead } from "@workspace/api-client-react";

import { Badge } from "@/components/ui/badge";
import { deriveLeadVelocity } from "@/lib/leadVelocity";

export interface LeadVelocityChipProps {
  lead: Pick<
    Lead,
    "createdAt" | "lastContactedAt" | "nextFollowUpAt" | "leadStatus"
  >;
  // Optional override — lets stories/tests pin the "now" reference so the
  // chip is deterministic. Production callers omit this.
  now?: Date;
  // referenceNumber is woven into the data-testid so e2e selectors can
  // pick out a specific row's chip without relying on row order.
  testIdSuffix?: string;
  className?: string;
}

/**
 * Compact visual indicator of operator-relevant lead urgency
 * (overdue follow-up, due soon, going stale, fresh-overnight).
 * Renders nothing for calm leads so the table/board stays uncluttered.
 */
export function LeadVelocityChip({
  lead,
  now,
  testIdSuffix,
  className,
}: LeadVelocityChipProps) {
  const v = deriveLeadVelocity(lead, now);
  if (!v) return null;
  return (
    <Badge
      variant="outline"
      title={v.tooltip}
      data-testid={
        testIdSuffix ? `velocity-chip-${testIdSuffix}` : "velocity-chip"
      }
      data-velocity-state={v.state}
      className={`text-[10px] py-0 px-1.5 font-medium tabular-nums ${
        v.className
      } ${className ?? ""}`}
    >
      {v.label}
    </Badge>
  );
}
