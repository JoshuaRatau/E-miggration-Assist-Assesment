import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// Phase 3 — read-only activity timeline.
//
// The dialog fetches `/api/admin/leads/:id/timeline` lazily on open
// (no preflight on row mount; thousands of admin rows must not each
// fire a network request just to render their "Timeline" button).
// The endpoint returns a pre-sorted desc list, so we render it as-is.
//
// We don't depend on the orval-generated hook here because the
// timeline endpoint is intentionally outside the typed Lead surface
// (see backend route comment) — keeping the fetch local lets the
// shape evolve without dragging the OpenAPI contract along.

interface TimelineEntry {
  kind: "audit" | "engagement" | "lead_created";
  at: string;
  title: string;
  detail?: string | null;
  actorEmail?: string | null;
  meta?: Record<string, unknown>;
}

interface TimelineResponse {
  leadId: string;
  referenceNumber: string | null;
  entries: TimelineEntry[];
}

const KIND_STYLES: Record<TimelineEntry["kind"], string> = {
  audit: "border-blue-300/40 bg-blue-500/10 text-blue-300",
  engagement: "border-emerald-300/40 bg-emerald-500/10 text-emerald-300",
  lead_created: "border-amber-300/40 bg-amber-500/10 text-amber-300",
};

function summariseAudit(entry: TimelineEntry): string {
  // The action is a snake_case verb (e.g. "lead_status_changed"). For
  // status / priority changes we surface the before→after delta so the
  // operator doesn't have to expand the JSON to see what happened.
  const before = (entry.meta?.before ?? null) as Record<string, unknown> | null;
  const after = (entry.meta?.after ?? null) as Record<string, unknown> | null;
  if (entry.title === "lead_status_changed" && before && after) {
    return `Status: ${String(before.leadStatus ?? "?")} → ${String(after.leadStatus ?? "?")}`;
  }
  if (entry.title === "lead_priority_changed" && before && after) {
    return `Priority: ${String(before.leadPriority ?? "?")} → ${String(after.leadPriority ?? "?")}`;
  }
  if (entry.title === "lead_converted") return "Lead converted to case";
  if (entry.title === "manual_contact_click") {
    const channel = after && (after.channel as string | undefined);
    return channel ? `Manual contact via ${channel}` : "Manual contact opened";
  }
  return entry.title.replace(/_/g, " ");
}

function summariseEngagement(entry: TimelineEntry): string {
  // engagement titles are `${channel}_${type}` (e.g. "email_update").
  const status = (entry.meta?.status as string | undefined) ?? "sent";
  return `${entry.title.replace(/_/g, " ")} (${status})`;
}

interface LeadTimelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  referenceNumber?: string | null;
}

export function LeadTimelineDialog({
  open,
  onOpenChange,
  leadId,
  referenceNumber,
}: LeadTimelineDialogProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/admin/leads/${leadId}/timeline`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as TimelineResponse;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-lead-timeline">
        <DialogHeader>
          <DialogTitle>Activity timeline</DialogTitle>
          <DialogDescription>
            {referenceNumber
              ? `All recorded activity for ${referenceNumber}, newest first.`
              : "All recorded activity for this lead, newest first."}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {error && (
          <div
            className="rounded-md border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-300"
            data-testid="timeline-error"
          >
            Could not load timeline: {error}
          </div>
        )}
        {data && data.entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
        {data && data.entries.length > 0 && (
          <ol
            className="max-h-[60vh] space-y-3 overflow-y-auto pr-1"
            data-testid="timeline-list"
          >
            {data.entries.map((entry, idx) => (
              <li
                key={`${entry.kind}-${entry.at}-${idx}`}
                className="rounded-md border border-border/60 bg-card/40 p-3"
                data-testid={`timeline-entry-${entry.kind}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={KIND_STYLES[entry.kind]}>
                        {entry.kind.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-sm font-medium">
                        {entry.kind === "audit"
                          ? summariseAudit(entry)
                          : entry.kind === "engagement"
                            ? summariseEngagement(entry)
                            : "Lead created"}
                      </span>
                    </div>
                    {entry.actorEmail && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        by {entry.actorEmail}
                      </p>
                    )}
                    {entry.detail && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                  <time className="whitespace-nowrap text-xs text-muted-foreground">
                    {format(new Date(entry.at), "MMM d, yyyy HH:mm")}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
