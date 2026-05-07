import { useMemo, useState } from "react";
import type { Lead } from "@workspace/api-client-react";

import {
  LEAD_STATUS_ORDER,
  canAdvanceStatus,
  statusLabel,
  type LeadStatus,
} from "@/lib/leadStatus";
import { Badge } from "@/components/ui/badge";
import { LeadVelocityChip } from "@/components/lead-velocity-chip";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { useToast } from "@/hooks/use-toast";

// Column accent colours mirror the existing 4-tile dashboard cues
// (new=blue, contacted=amber, qualified=green) and fan the rest of the
// funnel through the navy/teal palette so the board reads as one
// surface. The Tailwind classes here only colour the header strip — the
// body is the same dark card across columns to keep cognitive load low.
const COLUMN_HEADER_CLASS: Record<LeadStatus, string> = {
  new: "border-blue-500/60 text-blue-300",
  reviewing: "border-sky-500/60 text-sky-300",
  contacted: "border-amber-500/60 text-amber-300",
  awaiting_response: "border-yellow-500/60 text-yellow-200",
  engaged: "border-teal-500/60 text-teal-300",
  qualified: "border-green-500/60 text-green-300",
  proposal_sent: "border-violet-500/60 text-violet-300",
  ready_for_case: "border-fuchsia-500/60 text-fuchsia-300",
  converted: "border-emerald-500/60 text-emerald-300",
  closed: "border-slate-500/60 text-slate-400",
};

function priorityDotClass(priority: string | null | undefined): string {
  if (priority === "critical") return "bg-pink-500";
  if (priority === "high") return "bg-red-500";
  if (priority === "medium") return "bg-orange-500";
  if (priority === "low") return "bg-slate-400";
  return "bg-slate-600";
}

export interface LeadPipelineBoardProps {
  leads: Lead[];
  // Returns true when the move was accepted by the server (so the caller
  // can decide whether to clear local optimistic state). The host page
  // already does optimistic cache updates inside `patchLead`, so this
  // component does NOT keep its own local copy of the leads list — it
  // re-renders straight off the parent's `leads` prop after the mutation
  // succeeds (or rolls back).
  onMove: (leadId: string, targetStatus: LeadStatus) => Promise<boolean>;
}

/**
 * Kanban-style board for the existing 10-status lead funnel. Cards are
 * draggable via native HTML5 drag-and-drop (zero new deps); drops onto a
 * column trigger `onMove`, which delegates to the host page's existing
 * optimistic `patchLead` mutation so the board reuses its rollback +
 * toast machinery for free.
 *
 * Forward-only enforcement is mirrored client-side via `canAdvanceStatus`
 * so the user gets immediate visual feedback (target column flashes red
 * + a toast explains why) instead of waiting for the server's 409.
 */
export function LeadPipelineBoard({ leads, onMove }: LeadPipelineBoardProps) {
  const { toast } = useToast();

  // Track which lead is currently being dragged so we can (a) read its
  // current status synchronously inside the drop handler and (b) ignore
  // stray dragenter events from other elements on the page.
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  // Active hover target column → drives the dashed-outline highlight.
  // Stored as a tuple of {status, accepted} so we can colour the
  // highlight green/red depending on whether the move would be a valid
  // forward step.
  const [hoverTarget, setHoverTarget] = useState<{
    status: LeadStatus;
    accepted: boolean;
  } | null>(null);

  // Pre-bucket leads into columns. A lead with an unrecognised status
  // (legacy DB value) silently drops out of the board view rather than
  // creating a phantom column — the list view is still the canonical
  // place to see those.
  const columns = useMemo(() => {
    const buckets: Record<LeadStatus, Lead[]> = Object.fromEntries(
      LEAD_STATUS_ORDER.map((s) => [s, [] as Lead[]]),
    ) as Record<LeadStatus, Lead[]>;
    for (const lead of leads) {
      const s = lead.leadStatus as LeadStatus | undefined;
      if (s && s in buckets) buckets[s].push(lead);
    }
    return buckets;
  }, [leads]);

  const draggingLead = draggingLeadId
    ? leads.find((l) => l.id === draggingLeadId) ?? null
    : null;

  return (
    <div
      className="overflow-x-auto pb-3"
      data-testid="lead-pipeline-board"
    >
      <div className="flex gap-3 min-w-max">
        {LEAD_STATUS_ORDER.map((status) => {
          const colLeads = columns[status];
          const isHover = hoverTarget?.status === status;
          const accepted = hoverTarget?.accepted === true;
          // Visual outline: solid teal on a valid forward drop, red on a
          // forbidden (regression) drop, plain border otherwise.
          const outlineClass = !isHover
            ? "border-border/60"
            : accepted
              ? "border-teal-400 ring-2 ring-teal-400/30"
              : "border-red-500 ring-2 ring-red-500/30";
          return (
            <div
              key={status}
              data-testid={`pipeline-column-${status}`}
              className={`w-72 shrink-0 rounded-lg border bg-card/40 ${outlineClass} transition-colors`}
              onDragOver={(e) => {
                if (!draggingLead) return;
                // We MUST call preventDefault to mark the column as a
                // valid drop target; otherwise the browser swallows the
                // drop event entirely and the user just sees their card
                // snap back with no feedback.
                e.preventDefault();
                const allowed = canAdvanceStatus(
                  draggingLead.leadStatus,
                  status,
                );
                e.dataTransfer.dropEffect = allowed ? "move" : "none";
                if (
                  hoverTarget?.status !== status ||
                  hoverTarget?.accepted !== allowed
                ) {
                  setHoverTarget({ status, accepted: allowed });
                }
              }}
              onDragLeave={(e) => {
                // Only clear the highlight when the pointer truly leaves
                // the column (not when crossing onto a child card). The
                // relatedTarget check is the standard idiom here.
                if (
                  e.currentTarget.contains(e.relatedTarget as Node | null)
                ) {
                  return;
                }
                if (hoverTarget?.status === status) setHoverTarget(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setHoverTarget(null);
                const id = e.dataTransfer.getData("text/lead-id");
                if (!id) return;
                const lead = leads.find((l) => l.id === id);
                if (!lead) return;
                if (lead.leadStatus === status) return; // no-op drop
                if (!canAdvanceStatus(lead.leadStatus, status)) {
                  toast({
                    title: "Move blocked",
                    description: `Pipeline is forward-only — can't move "${statusLabel(
                      lead.leadStatus ?? "—",
                    )}" → "${statusLabel(status)}".`,
                    variant: "destructive",
                  });
                  return;
                }
                await onMove(id, status);
              }}
            >
              <div
                className={`flex items-center justify-between px-3 py-2 border-b-2 ${COLUMN_HEADER_CLASS[status]} bg-background/40 rounded-t-lg`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {statusLabel(status)}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] tabular-nums"
                  data-testid={`pipeline-count-${status}`}
                >
                  {colLeads.length}
                </Badge>
              </div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {colLeads.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic px-1 py-3 text-center">
                    No leads
                  </p>
                ) : (
                  colLeads.map((lead) => (
                    <PipelineCard
                      key={lead.id}
                      lead={lead}
                      isDragging={draggingLeadId === lead.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/lead-id", lead.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingLeadId(lead.id);
                      }}
                      onDragEnd={() => {
                        setDraggingLeadId(null);
                        setHoverTarget(null);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PipelineCardProps {
  lead: Lead;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function PipelineCard({
  lead,
  isDragging,
  onDragStart,
  onDragEnd,
}: PipelineCardProps) {
  const displayName =
    lead.leadType === "professional"
      ? lead.organizationName ?? lead.representativeName ?? lead.fullName ?? "—"
      : lead.fullName ?? lead.email ?? "—";
  const subtitle =
    lead.leadType === "professional"
      ? lead.representativeEmail ?? lead.email ?? lead.referenceNumber
      : lead.email ?? lead.whatsapp ?? lead.referenceNumber;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid={`pipeline-card-${lead.id}`}
      className={`rounded-md border bg-background/80 px-3 py-2 cursor-grab active:cursor-grabbing shadow-sm hover:border-teal-400/60 transition-colors ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${priorityDotClass(
            lead.leadPriority,
          )}`}
          aria-label={`Priority ${lead.leadPriority ?? "unknown"}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" title={displayName}>
            {displayName}
          </p>
          {subtitle ? (
            <p
              className="text-[11px] text-muted-foreground truncate"
              title={subtitle}
            >
              {subtitle}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <LeadScoreBadge
              lead={lead}
              compact
              testIdSuffix={`pipeline-${lead.id}`}
            />
            <Badge
              variant="outline"
              className="text-[10px] py-0 px-1.5 capitalize"
            >
              {lead.leadType ?? "individual"}
            </Badge>
            <LeadVelocityChip
              lead={lead}
              testIdSuffix={`pipeline-${lead.id}`}
            />
            {lead.referenceNumber ? (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {lead.referenceNumber}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
