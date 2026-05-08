import { useEffect, useState } from "react";
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
import { ArrowLeft, Loader2 } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

export function AdminCampaignDetail() {
  const [, params] = useRoute<{ id: string }>(
    "/admin/communications/campaigns/:id",
  );
  const id = params?.id;
  const [data, setData] = useState<{
    campaign: Campaign;
    recipients: Recipient[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/admin/campaigns/${id}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  return (
    <AdminLayout
      title={`Campaign · ${c.name}`}
      bodyClassName="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100"
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
            <p className="mt-1 text-sm text-slate-400">
              {c.channel} · {c.status}
              {c.sentAt
                ? ` · sent ${format(new Date(c.sentAt), "MMM d, HH:mm")}`
                : ""}
            </p>
          </div>
        </div>

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
