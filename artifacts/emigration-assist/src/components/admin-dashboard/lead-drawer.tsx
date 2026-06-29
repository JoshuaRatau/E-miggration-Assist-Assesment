import { Link } from "wouter";
import type { Lead } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { segmentOfLead } from "@/lib/leadSegment";
import { statusLabel } from "@/lib/leadStatus";

const SEGMENT_LABEL: Record<string, string> = {
  individual: "Individual",
  overstay: "Overstay",
  business: "Business",
};

/**
 * Right-side lead drawer — PLACEHOLDER for Phase 1.
 *
 * Renders identity + headline fields and a link into the existing full lead
 * page. The rich in-drawer workspace (timeline, quick actions, assignment,
 * notes) is wired in a later phase; this establishes the surface without
 * touching the existing /admin/lead/:id view.
 */
export function LeadDrawer({
  lead,
  onClose,
}: {
  lead: Lead | null;
  onClose: () => void;
}) {
  const open = lead !== null;
  const segment = lead ? segmentOfLead(lead) : null;
  const name =
    lead?.fullName ??
    lead?.organizationName ??
    lead?.representativeName ??
    lead?.email ??
    lead?.referenceNumber ??
    "Lead";

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        data-testid="dashboard-lead-drawer"
      >
        <SheetHeader>
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {lead?.referenceNumber}
          </SheetDescription>
        </SheetHeader>

        {lead && (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
              <dt className="col-span-1 text-muted-foreground">Segment</dt>
              <dd className="col-span-2 font-medium">
                {segment ? (SEGMENT_LABEL[segment] ?? segment) : "—"}
              </dd>
              <dt className="col-span-1 text-muted-foreground">Status</dt>
              <dd className="col-span-2 font-medium">
                {statusLabel(lead.leadStatus)}
              </dd>
              <dt className="col-span-1 text-muted-foreground">Priority</dt>
              <dd className="col-span-2 font-medium capitalize">
                {lead.leadPriority ?? "—"}
              </dd>
              <dt className="col-span-1 text-muted-foreground">Owner</dt>
              <dd className="col-span-2 font-medium">
                {lead.assignedTo ? "Assigned" : "Unassigned"}
              </dd>
              {lead.email && (
                <>
                  <dt className="col-span-1 text-muted-foreground">Email</dt>
                  <dd className="col-span-2 break-all font-medium">
                    {lead.email}
                  </dd>
                </>
              )}
            </dl>

            <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              The full in-drawer workspace — timeline, assignment, notes and
              quick actions — arrives in a later phase. For now, open the full
              lead view for all actions.
            </div>
          </div>
        )}

        <SheetFooter className="mt-6">
          {lead && (
            <Link href={`/admin/lead/${lead.id}`} className="w-full">
              <Button
                className="w-full"
                data-testid="dashboard-lead-drawer-open-full"
              >
                Open full lead
              </Button>
            </Link>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
