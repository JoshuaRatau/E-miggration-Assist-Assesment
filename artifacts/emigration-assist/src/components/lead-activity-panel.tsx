import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";

// Phase 6B PR 3 — shape of `GET /api/admin/leads/:id/events`. The
// endpoint is intentionally NOT in the OpenAPI spec (sibling resource,
// shape may evolve as we add scoring rules), so the response type lives
// alongside the only consumer.
interface LeadEventRow {
  id: string;
  type: string;
  points: number;
  rubric: string;
  source: string;
  occurredAt: string;
}

interface LeadEventsResponse {
  leadId: string;
  leadScore: number | null;
  leadScoreRubric: string | null;
  leadScoreBreakdown:
    | Array<{ rule: string; points: number; occurrences: number }>
    | null;
  leadScoreComputedAt: string | null;
  events: LeadEventRow[];
}

const SOURCE_CLASS: Record<string, string> = {
  system: "bg-slate-500/10 text-slate-400 border-slate-500/40",
  user: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
  webhook: "bg-amber-500/10 text-amber-300 border-amber-500/40",
};

function pointsClass(points: number): string {
  if (points > 0) return "text-emerald-400";
  if (points < 0) return "text-rose-400";
  return "text-muted-foreground";
}

export function LeadActivityPanel({ leadId }: { leadId: string }) {
  const { data, isLoading, isError, error } = useQuery<
    LeadEventsResponse,
    Error
  >({
    queryKey: ["admin", "lead", leadId, "events"],
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/admin/leads/${leadId}/events`,
        { headers: { "x-admin-token": token } },
      );
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return (await res.json()) as LeadEventsResponse;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Score Activity</CardTitle>
        <CardDescription>
          Append-only signals consumed by the score recompute worker.
          {data?.leadScoreComputedAt ? (
            <>
              {" "}
              Last computed{" "}
              <span title={format(new Date(data.leadScoreComputedAt), "PPpp")}>
                {formatDistanceToNow(new Date(data.leadScoreComputedAt), {
                  addSuffix: true,
                })}
              </span>
              {data.leadScoreRubric ? (
                <>
                  {" "}
                  using the <strong>{data.leadScoreRubric}</strong> rubric.
                </>
              ) : (
                "."
              )}
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : isError ? (
          <div className="text-sm text-rose-400" data-testid="activity-error">
            Failed to load activity: {error?.message ?? "unknown error"}
          </div>
        ) : !data || data.events.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No score-affecting events recorded yet. The next worker tick
            will pick up new events within ~60s.
          </div>
        ) : (
          <ul
            className="divide-y divide-border/40"
            data-testid="activity-list"
          >
            {data.events.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-4 py-2"
                data-testid={`activity-row-${e.type}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {e.type}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] py-0 px-1.5 uppercase tracking-wide ${
                        SOURCE_CLASS[e.source] ?? SOURCE_CLASS.system
                      }`}
                    >
                      {e.source}
                    </Badge>
                  </div>
                  <div
                    className="text-xs text-muted-foreground"
                    title={format(new Date(e.occurredAt), "PPpp")}
                  >
                    {formatDistanceToNow(new Date(e.occurredAt), {
                      addSuffix: true,
                    })}
                    {" · "}
                    rubric snapshot: <code>{e.rubric}</code>
                  </div>
                </div>
                <div
                  className={`font-mono text-sm tabular-nums ${pointsClass(
                    e.points,
                  )}`}
                >
                  {e.points > 0 ? `+${e.points}` : `${e.points}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
