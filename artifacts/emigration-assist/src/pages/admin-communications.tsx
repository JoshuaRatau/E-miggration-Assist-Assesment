import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Send, Mail, MessageSquare } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TabKey = "campaigns" | "templates" | "notifications" | "reports";

const TABS: Array<{ key: TabKey; href: string; label: string; testId: string }> = [
  {
    key: "campaigns",
    href: "/admin/communications",
    label: "Campaigns",
    testId: "tab-campaigns",
  },
  {
    key: "templates",
    href: "/admin/communications/templates",
    label: "Templates",
    testId: "tab-templates",
  },
  {
    key: "notifications",
    href: "/admin/communications/notifications",
    label: "System Notifications",
    testId: "tab-notifications",
  },
  {
    key: "reports",
    href: "/admin/communications/reports",
    label: "Reports",
    testId: "tab-reports",
  },
];

function tabFromLocation(loc: string): TabKey {
  if (loc.startsWith("/admin/communications/templates")) return "templates";
  if (loc.startsWith("/admin/communications/notifications"))
    return "notifications";
  if (loc.startsWith("/admin/communications/reports")) return "reports";
  return "campaigns";
}

export function AdminCommunications() {
  const [location] = useLocation();
  const active = tabFromLocation(location);

  return (
    <AdminLayout
      title="Communications"
      bodyClassName="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100"
      contentClassName="flex-1 mx-auto max-w-7xl w-full px-6 pt-6 pb-12"
    >
      <>
        <div className="mb-2">
          <h1
            className="text-2xl font-semibold tracking-tight"
            data-testid="page-title-communications"
          >
            Communications
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Outbound campaigns, message templates, system notifications, and
            delivery reports.
          </p>
        </div>

        <div
          className="mt-6 mb-6 flex gap-1 border-b border-slate-700/40"
          role="tablist"
          aria-label="Communications sections"
        >
          {TABS.map((t) => {
            const isActive = t.key === active;
            return (
              <Link key={t.key} href={t.href}>
                <a
                  role="tab"
                  aria-selected={isActive}
                  data-testid={t.testId}
                  className={
                    "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
                    (isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-slate-400 hover:text-slate-200")
                  }
                >
                  {t.label}
                </a>
              </Link>
            );
          })}
        </div>

        {active === "campaigns" ? <CampaignsPanel /> : null}
        {active === "templates" ? <ComingSoonPanel kind="templates" /> : null}
        {active === "notifications" ? (
          <ComingSoonPanel kind="notifications" />
        ) : null}
        {active === "reports" ? <ReportsPanel /> : null}
      </>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------------------
// Campaigns panel — embedded list (was the standalone /admin/campaigns page).

interface Campaign {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  status: "draft" | "sending" | "completed" | "cancelled";
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsSkipped: number;
  recipientsUnsubscribed: number;
  createdAt: string;
  sentAt: string | null;
}

const STATUS_TONE: Record<Campaign["status"], string> = {
  draft: "border-slate-300/40 bg-slate-500/10 text-slate-300",
  sending: "border-amber-300/40 bg-amber-500/10 text-amber-200",
  completed: "border-emerald-300/40 bg-emerald-500/10 text-emerald-200",
  cancelled: "border-rose-300/40 bg-rose-500/10 text-rose-200",
};

function CampaignsPanel() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newChannel, setNewChannel] = useState<"email" | "whatsapp">("email");
  const { toast } = useToast();

  async function load() {
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()) as Campaign[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createDraft() {
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled campaign",
          channel: newChannel,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Campaign;
      setLocation(`/admin/communications/campaigns/${created.id}/edit`);
    } catch (e) {
      toast({
        title: "Could not create campaign",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div data-testid="panel-campaigns">
      <div className="mb-4 flex items-center justify-end">
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={creating}
          data-testid="button-new-campaign"
        >
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          New campaign
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} key="new-campaign-dialog">
        <DialogContent data-testid="dialog-new-campaign">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              Pick a delivery channel. This is locked once the draft is created.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs text-slate-400">Channel</Label>
            <Select
              value={newChannel}
              onValueChange={(v) => setNewChannel(v as "email" | "whatsapp")}
            >
              <SelectTrigger className="mt-1" data-testid="select-new-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={createDraft}
              disabled={creating}
              data-testid="button-confirm-create"
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error ? (
        <Card className="mb-4 border-rose-500/30 bg-rose-500/10">
          <CardContent className="py-4 text-sm text-rose-200">
            {error}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">All campaigns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items === null ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-400">
              No campaigns yet. Create your first one to start.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id} data-testid={`row-campaign-${c.id}`}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                        {c.channel === "email" ? (
                          <Mail className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                        {c.channel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_TONE[c.status]}
                        data-testid={`status-pill-${c.id}`}
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-200">
                      {c.recipientsSent}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-200">
                      {c.recipientsFailed}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-400">
                      {c.recipientsSkipped + c.recipientsUnsubscribed}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {format(new Date(c.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "draft" ? (
                        <Link
                          href={`/admin/communications/campaigns/${c.id}/edit`}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-edit-${c.id}`}
                          >
                            Edit
                          </Button>
                        </Link>
                      ) : (
                        <Link href={`/admin/communications/campaigns/${c.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-view-${c.id}`}
                          >
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            View
                          </Button>
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coming-soon placeholders for Templates & System Notifications.

function ComingSoonPanel({ kind }: { kind: "templates" | "notifications" }) {
  const copy =
    kind === "templates"
      ? {
          title: "Reusable message templates",
          body: "Save email and WhatsApp templates with merge tokens here, then reuse them across campaigns and one-to-one outreach. Coming soon.",
        }
      : {
          title: "System notifications",
          body: "Configure operator-facing alerts (lead-stage changes, SLA breaches, failed sends) and the channels they fire on. Coming soon.",
        };
  return (
    <Card
      className="border-slate-700/40 bg-slate-900/40"
      data-testid={`panel-${kind}`}
    >
      <CardContent className="py-12 text-center">
        <h2 className="text-lg font-semibold text-slate-200">{copy.title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          {copy.body}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reports panel — DB-only stats. Open/click rates intentionally omitted.

interface ReportsTotals {
  totalCampaigns: number;
  drafts: number;
  sending: number;
  completed: number;
  cancelled: number;
  emailCampaigns: number;
  whatsappCampaigns: number;
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsSkipped: number;
  recipientsUnsubscribed: number;
}

interface ReportsRecent {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  status: string;
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  sentAt: string | null;
  createdAt: string;
}

function ReportsPanel() {
  const [data, setData] = useState<{
    totals: ReportsTotals;
    recent: ReportsRecent[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/admin/campaigns/stats`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load reports");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const successRate = useMemo(() => {
    if (!data) return null;
    const denom = data.totals.recipientsSent + data.totals.recipientsFailed;
    if (denom === 0) return null;
    return Math.round((data.totals.recipientsSent / denom) * 1000) / 10;
  }, [data]);

  if (error)
    return (
      <Card
        className="border-rose-500/30 bg-rose-500/10"
        data-testid="panel-reports-error"
      >
        <CardContent className="py-4 text-sm text-rose-200">{error}</CardContent>
      </Card>
    );
  if (!data)
    return (
      <div
        className="flex items-center justify-center py-12"
        data-testid="panel-reports-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );

  const t = data.totals;

  return (
    <div data-testid="panel-reports" className="space-y-6">
      <p className="text-xs text-slate-500">
        Reports show what the database knows: how many campaigns, how many
        recipients, and how many sends succeeded vs failed. Email open and
        link-click tracking are not yet wired and will appear here once
        provider webhooks are connected.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total campaigns" value={t.totalCampaigns} />
        <Stat label="Drafts" value={t.drafts} tone="slate" />
        <Stat label="Completed" value={t.completed} tone="emerald" />
        <Stat label="Cancelled" value={t.cancelled} tone="rose" />
      </div>

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">Delivery totals (all time)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Recipients" value={t.recipientsTotal} bold />
            <Stat label="Sent" value={t.recipientsSent} tone="emerald" bold />
            <Stat label="Failed" value={t.recipientsFailed} tone="rose" bold />
            <Stat label="Skipped" value={t.recipientsSkipped} />
            <Stat
              label="Unsubscribed"
              value={t.recipientsUnsubscribed}
              tone="amber"
            />
          </div>
          {successRate !== null ? (
            <p
              className="mt-4 text-xs text-slate-400"
              data-testid="reports-success-rate"
            >
              Send success rate:{" "}
              <span className="text-slate-200 font-medium tabular-nums">
                {successRate}%
              </span>{" "}
              ({t.recipientsSent.toLocaleString()} of{" "}
              {(t.recipientsSent + t.recipientsFailed).toLocaleString()}{" "}
              attempts)
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">By channel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Email campaigns"
              value={t.emailCampaigns}
              tone="violet"
            />
            <Stat
              label="WhatsApp campaigns"
              value={t.whatsappCampaigns}
              tone="emerald"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.recent.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-400">
              No campaigns yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Sent at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r) => (
                  <TableRow
                    key={r.id}
                    data-testid={`reports-recent-row-${r.id}`}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/admin/communications/campaigns/${r.id}`}>
                        <a className="text-slate-200 hover:text-primary">
                          {r.name}
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                        {r.channel === "email" ? (
                          <Mail className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                        {r.channel}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {r.status}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-200">
                      {r.recipientsSent}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-200">
                      {r.recipientsFailed}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {r.sentAt
                        ? format(new Date(r.sentAt), "MMM d, HH:mm")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
  bold,
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "rose" | "amber" | "violet";
  bold?: boolean;
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
      <div
        className={`mt-1 ${bold ? "text-2xl" : "text-xl"} font-semibold tabular-nums ${cls}`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
