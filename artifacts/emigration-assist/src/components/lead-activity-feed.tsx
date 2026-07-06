import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// Shared, read-only per-lead activity feed.
//
// Fetches `/api/admin/leads/:id/timeline` (audit + engagement + the
// synthetic lead_created event, pre-sorted newest-first) and renders it
// as a vertical feed. Extracted so the same render can back both the
// table-row Timeline dialog and the in-drawer Activity tab without
// duplicating the fetch / summarise logic.
//
// The endpoint is intentionally outside the typed Lead surface (sibling
// resource, shape may evolve), so the response type lives alongside its
// consumers rather than in the OpenAPI contract.

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
  audit: "border-blue-300/40 bg-blue-500/10 text-blue-700",
  engagement: "border-emerald-300/40 bg-emerald-500/10 text-emerald-700",
  lead_created: "border-amber-300/40 bg-amber-500/10 text-amber-700",
};

function summariseAudit(entry: TimelineEntry): string {
  const before = (entry.meta?.before ?? null) as Record<string, unknown> | null;
  const after = (entry.meta?.after ?? null) as Record<string, unknown> | null;
  if (entry.title === "lead_status_changed" && before && after) {
    return `Status: ${String(before.leadStatus ?? "?")} → ${String(after.leadStatus ?? "?")}`;
  }
  if (entry.title === "lead_priority_changed" && before && after) {
    return `Priority: ${String(before.leadPriority ?? "?")} → ${String(after.leadPriority ?? "?")}`;
  }
  if (entry.title === "lead_note_added") {
    const noteText = after && typeof after.note === "string" ? after.note : "";
    return noteText ? `Note: ${noteText}` : "Internal note added";
  }
  if (entry.title === "lead_converted") return "Lead converted to case";
  if (entry.title === "manual_contact_click") {
    const channel = after && (after.channel as string | undefined);
    return channel ? `Manual contact via ${channel}` : "Manual contact opened";
  }
  return entry.title.replace(/_/g, " ");
}

function summariseEngagement(entry: TimelineEntry): string {
  const status = (entry.meta?.status as string | undefined) ?? "sent";
  return `${entry.title.replace(/_/g, " ")} (${status})`;
}

export function LeadActivityFeed({
  leadId,
  className,
}: {
  leadId: string | null;
  className?: string;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(
      `${(import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "")}/api/admin/leads/${leadId}/timeline`,
      { credentials: "include" },
    )
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
  }, [leadId]);

  if (loading) {
    return (
      <div className="space-y-2" data-testid="activity-feed-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-md border border-red-300/40 bg-red-500/10 p-3 text-sm text-red-700"
        data-testid="activity-feed-error"
      >
        Could not load activity: {error}
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="activity-feed-empty"
      >
        No activity recorded yet.
      </p>
    );
  }

  return (
    <ol className={`space-y-3 ${className ?? ""}`} data-testid="activity-feed-list">
      {data.entries.map((entry, idx) => (
        <li
          key={`${entry.kind}-${entry.at}-${idx}`}
          className="rounded-md border border-border/60 bg-card/40 p-3"
          data-testid={`activity-feed-entry-${entry.kind}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
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
  );
}
