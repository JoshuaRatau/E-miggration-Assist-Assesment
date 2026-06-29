import type { Lead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

/**
 * Critical-overstay alert banner. Shown when one or more unassigned,
 * critical-priority overstay leads exist. Phase 1 is UI-only — the action
 * opens the lead drawer; automated escalation arrives in a later phase.
 */
export function CriticalAlertBanner({
  leads,
  onAction,
}: {
  leads: Lead[];
  onAction: (lead: Lead) => void;
}) {
  if (leads.length === 0) return null;
  const [first, ...rest] = leads;
  const name =
    first.fullName ??
    first.email ??
    first.referenceNumber ??
    "An overstay lead";

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
      data-testid="dashboard-critical-banner"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden>
          🚨
        </span>
        <div className="text-sm">
          <div className="font-semibold text-rose-800">
            Critical SLA — {name} requires partner contact
          </div>
          <div className="text-rose-700">
            Overstay risk, marked critical, with no owner assigned.
            {rest.length > 0 && (
              <>
                {" "}
                <span className="font-medium">
                  +{rest.length} more unassigned critical overstay lead
                  {rest.length > 1 ? "s" : ""}.
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <Button
        className="shrink-0 bg-rose-600 text-white hover:bg-rose-700"
        size="sm"
        onClick={() => onAction(first)}
        data-testid="dashboard-critical-banner-action"
      >
        Assign &amp; call now
      </Button>
    </div>
  );
}
