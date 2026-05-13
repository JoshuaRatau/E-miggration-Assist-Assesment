import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLayout } from "@/components/admin-layout";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Pause, Play, X } from "lucide-react";
import { format } from "date-fns";

const BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "");

interface Campaign {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  status: string;
  templateSubject: string | null;
  templateBody: string | null;
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsSkipped: number;
  recipientsUnsubscribed: number;
  audienceSnapshotCount: number;
  createdAt: string;
  sentAt: string | null;
  scheduledAt: string | null;
}

interface Recipient {
  id: string;
  leadId: string;
  status: "queued" | "sent" | "failed" | "skipped" | "unsubscribed";
  reason: string | null;
  channelUsed: string | null;
  sentAt: string | null;
  leadName: string | null;
  leadEmail: string | null;
  leadWhatsapp: string | null;
  leadReference: string | null;
}

const STATUS_TONE: Record<Recipient["status"], string> = {
  queued: "border-slate-300/40 bg-slate-500/10 text-slate-300",
  sent: "border-emerald-300/40 bg-emerald-500/10 text-emerald-200",
  failed: "border-rose-300/40 bg-rose-500/10 text-rose-200",
  skipped: "border-amber-300/40 bg-amber-500/10 text-amber-200",
  unsubscribed: "border-violet-300/40 bg-violet-500/10 text-violet-200",
};

const CAMPAIGN_STATUS_TONE: Record<string, string> = {
  draft: "border-slate-300/40 bg-slate-500/10 text-slate-300",
  scheduled: "border-sky-300/40 bg-sky-500/10 text-sky-200",
  sending: "border-blue-300/40 bg-blue-500/10 text-blue-200",
  paused: "border-amber-300/40 bg-amber-500/10 text-amber-200",
  completed: "border-emerald-300/40 bg-emerald-500/10 text-emerald-200",
  cancelled: "border-rose-300/40 bg-rose-500/10 text-rose-200",
};

// Pretty-print a "fires in X" countdown string for the scheduled banner.
function countdown(toIso: string): string {
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1 minute";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return `${h}h ${rem}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function AdminCampaignDetail() {
  const [, params] = useRoute<{ id: string }>(
    "/admin/communications/campaigns/:id",
  );
  const id = params?.id;
  const { toast } = useToast();
  const [data, setData] = useState<{
    campaign: Campaign;
    recipients: Recipient[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<null | "pause" | "resume" | "unschedule">(
    null,
  );
  // Bumps every minute so the countdown re-renders without us having to
  // re-fetch the whole campaign.
  const [, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    if (!id) return;
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live polling while the campaign is in a non-terminal state, plus a
  // 1-minute tick for the scheduled-countdown label.
  useEffect(() => {
    if (!data) return;
    const status = data.campaign.status;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 60_000);
    if (status === "sending" || status === "paused" || status === "scheduled") {
      pollRef.current = setInterval(() => void load(), 5_000);
    }
    return () => {
      clearInterval(interval);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.campaign.status]);

  async function act(action: "pause" | "resume" | "unschedule") {
    if (!id) return;
    setActing(action);
    try {
      const res = await fetch(
        `${BASE}/api/admin/campaigns/${id}/${action}`,
        { method: "POST", credentials: "include" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({
        title:
          action === "pause"
            ? "Campaign paused"
            : action === "resume"
              ? `Resumed${
                  typeof json.requeued === "number"
                    ? ` (${json.requeued} re-queued)`
                    : ""
                }`
              : "Schedule cancelled — campaign back in draft",
      });
      await load();
    } catch (e) {
      toast({
        title: `${action} failed`,
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActing(null);
    }
  }

  if (error)
    return (
      <AdminLayout title="Campaign" bodyClassName="bg-slate-950 text-rose-300">
        <div className="p-8">{error}</div>
      </AdminLayout>
    );
  if (!data)
    return (
      <AdminLayout title="Campaign" bodyClassName="bg-slate-950">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </AdminLayout>
    );

  const c = data.campaign;
  const statusTone =
    CAMPAIGN_STATUS_TONE[c.status] ??
    "border-slate-300/40 bg-slate-500/10 text-slate-300";

  return (
    <AdminLayout
      title={`Campaign · ${c.name}`}
      bodyClassName="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100"
      contentClassName="flex-1 mx-auto max-w-7xl w-full px-6 pt-6 pb-12"
    >
      <>
        <Link href="/admin/communications">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4"
            data-testid="button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            All campaigns
          </Button>
        </Link>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              data-testid="page-title-campaign-detail"
            >
              {c.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>{c.channel}</span>
              <span>·</span>
              <Badge
                variant="outline"
                className={statusTone}
                data-testid="badge-campaign-status"
              >
                {c.status}
              </Badge>
              {c.sentAt
                ? (
                  <>
                    <span>·</span>
                    <span>
                      sent {format(new Date(c.sentAt), "MMM d, HH:mm")}
                    </span>
                  </>
                )
                : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {c.status === "scheduled" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => act("unschedule")}
                disabled={acting !== null}
                data-testid="button-unschedule"
              >
                {acting === "unschedule" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Cancel schedule
              </Button>
            ) : null}
            {c.status === "sending" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => act("pause")}
                disabled={acting !== null}
                data-testid="button-pause"
              >
                {acting === "pause" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Pause className="mr-2 h-4 w-4" />
                )}
                Pause
              </Button>
            ) : null}
            {c.status === "paused" ? (
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={() => act("resume")}
                disabled={acting !== null}
                data-testid="button-resume"
              >
                {acting === "resume" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Resume
              </Button>
            ) : null}
          </div>
        </div>

        {c.status === "scheduled" && c.scheduledAt ? (
          <div
            className="mb-6 rounded-md border border-sky-300/40 bg-sky-500/10 p-3 text-sm text-sky-100"
            data-testid="banner-scheduled"
          >
            Scheduled to send in <strong>{countdown(c.scheduledAt)}</strong>{" "}
            (around {format(new Date(c.scheduledAt), "MMM d, HH:mm")}). The
            campaign stays editable until then — open the editor to change
            audience, body, or unschedule.
          </div>
        ) : null}
        {c.status === "paused" ? (
          <div
            className="mb-6 rounded-md border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-100"
            data-testid="banner-paused"
          >
            Sending is paused. New recipients will not be dispatched until you
            resume. Already-in-flight recipients (claimed but not yet settled)
            may still complete.
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Audience" value={c.audienceSnapshotCount} />
          <Stat label="Sent" value={c.recipientsSent} tone="emerald" />
          <Stat label="Failed" value={c.recipientsFailed} tone="rose" />
          <Stat label="Skipped" value={c.recipientsSkipped} tone="amber" />
          <Stat
            label="Unsubscribed"
            value={c.recipientsUnsubscribed}
            tone="violet"
          />
        </div>

        <Card className="border-slate-700/40 bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-base">
              Recipients ({data.recipients.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.recipients.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-slate-400">
                No recipients yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Sent at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recipients.map((r) => (
                    <TableRow
                      key={r.id}
                      data-testid={`row-recipient-${r.id}`}
                    >
                      <TableCell>
                        <Link
                          href={`/admin/lead/${r.leadId}`}
                          className="text-slate-200 hover:underline"
                        >
                          {r.leadName ?? "(no name)"}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {r.leadEmail ?? r.leadWhatsapp ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-400">
                        {r.leadReference}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {r.channelUsed ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[r.status]}
                          data-testid={`status-${r.id}`}
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {r.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {r.sentAt
                          ? format(new Date(r.sentAt), "HH:mm:ss")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </>
    </AdminLayout>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "rose" | "amber" | "violet";
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "rose"
        ? "text-rose-300"
        : tone === "amber"
          ? "text-amber-300"
          : tone === "violet"
            ? "text-violet-300"
            : "text-slate-200";
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  );
}
