import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiBase";
import {
  Facebook,
  Instagram,
  RefreshCw,
  Link2,
  Unlink,
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Meta Analytics — Facebook & Instagram performance dashboard.
 *
 * Reads ONLY cached data from our own backend (which syncs from the Meta
 * Graph API). No mock data anywhere: metrics that Meta does not expose or
 * that have not synced yet render an explicit "unavailable" state.
 */

// ---------------------------------------------------------------------------
// data hooks

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

type StatusResponse = {
  appConfigured: boolean;
  redirectUri: string | null;
  syncRunning: boolean;
  connection: {
    status: string;
    facebookPageName: string | null;
    instagramUsername: string | null;
    adAccountName: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
  } | null;
  lastSync: { status: string; startedAt: string; finishedAt: string | null } | null;
};

type Kpi = {
  key: string;
  label: string;
  format: string;
  current: number | null;
  previous: number | null;
  changePct: number | null;
  available: boolean;
};

const PRESETS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "28", label: "Last 28 days", days: 28 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;

function rangeForPreset(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 86400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function fmt(n: number | null, format?: string): string {
  if (n === null || n === undefined) return "—";
  if (format === "duration_ms") {
    const h = n / 3_600_000;
    return h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(n / 60_000)} min`;
  }
  return n >= 10_000 ? n.toLocaleString() : String(Math.round(n * 100) / 100);
}

// ---------------------------------------------------------------------------

export function AdminMetaAnalytics() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [preset, setPreset] = useState<string>("28");
  const [platform, setPlatform] = useState<"all" | "facebook" | "instagram">("all");
  const [chartMetric, setChartMetric] = useState("views");

  const range = useMemo(
    () => rangeForPreset(PRESETS.find((p) => p.key === preset)?.days ?? 28),
    [preset],
  );
  const rq = `from=${range.from}&to=${range.to}`;

  const status = useQuery({
    queryKey: ["meta", "status"],
    queryFn: () => getJson<StatusResponse>("/api/meta/status"),
    refetchInterval: (q) => (q.state.data?.syncRunning ? 5000 : false),
  });
  const connected = Boolean(
    status.data?.connection && status.data.connection.status !== "disconnected",
  );

  const overview = useQuery({
    queryKey: ["meta", "overview", rq, platform],
    queryFn: () =>
      getJson<{ kpis: Kpi[] }>(`/api/meta/overview?${rq}&platform=${platform}`),
    enabled: connected,
  });

  const series = useQuery({
    queryKey: ["meta", "performance", rq, platform, chartMetric],
    queryFn: () =>
      getJson<{ series: Array<{ date: string; value: number }>; label: string; available: boolean }>(
        `/api/meta/performance?${rq}&platform=${platform}&metric=${chartMetric}`,
      ),
    enabled: connected,
  });

  const audience = useQuery({
    queryKey: ["meta", "audience", rq],
    queryFn: () =>
      getJson<{
        follows: number | null;
        unfollows: number | null;
        netFollows: number | null;
        reach: number | null;
        demographics: { country: Record<string, number> | null; asOf: string | null };
      }>(`/api/meta/audience?${rq}`),
    enabled: connected,
  });

  const content = useQuery({
    queryKey: ["meta", "content", rq, platform],
    queryFn: () =>
      getJson<{ items: Array<Record<string, unknown>> }>(
        `/api/meta/content?${rq}&platform=${platform}&sort=most_engaged`,
      ),
    enabled: connected,
  });

  const campaigns = useQuery({
    queryKey: ["meta", "campaigns"],
    queryFn: () =>
      getJson<{
        campaigns: Array<Record<string, unknown>>;
        totals: Record<string, number>;
      }>("/api/meta/campaigns"),
    enabled: connected,
  });

  const leads = useQuery({
    queryKey: ["meta", "leads", rq],
    queryFn: () => getJson<{ leads: Array<Record<string, unknown>> }>(`/api/meta/leads?${rq}`),
    enabled: connected,
  });

  const conversions = useQuery({
    queryKey: ["meta", "conversions", rq],
    queryFn: () =>
      getJson<{
        internal: {
          metaLeads: number;
          qualifiedLeads: number;
          convertedLeads: number;
          conversionRate: number | null;
        };
        metaReported: {
          spend: number | null;
          leads: number | null;
          costPerLead: number | null;
          impressions: number | null;
          clicks: number | null;
        };
      }>(`/api/meta/conversions?${rq}`),
    enabled: connected,
  });

  const connect = useMutation({
    mutationFn: () => getJson<{ url: string }>("/api/meta/auth/start"),
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e: Error) =>
      toast({ title: "Could not start Meta login", description: e.message, variant: "destructive" }),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/meta/sync"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; error?: string; sections?: Record<string, string> }>;
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast({ title: "Sync finished", description: "Fresh Meta data has been pulled in." });
      } else {
        toast({
          title: "Sync completed with issues",
          description: data.error ?? "Some metrics could not be pulled in. Check the connection strip for details.",
          variant: "destructive",
        });
      }
      void qc.invalidateQueries({ queryKey: ["meta"] });
    },
    onError: (e: Error) =>
      toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const disconnectM = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/meta/disconnect"), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast({ title: "Meta account disconnected" });
      void qc.invalidateQueries({ queryKey: ["meta"] });
    },
  });

  const download = (kind: string) => {
    const a = document.createElement("a");
    a.href = apiUrl(`/api/meta/export?kind=${kind}&${rq}`);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ── header ────────────────────────────────────────────────────────────
  const conn = status.data?.connection ?? null;

  return (
    <AdminLayout title="Meta Analytics">
      <div className="max-w-6xl mx-auto py-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-display font-semibold" data-testid="text-meta-title">
              Meta Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              Facebook &amp; Instagram performance, ads and leads — real data synced from Meta.
            </p>
          </div>
          {connected && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => sync.mutate()}
                disabled={sync.isPending || status.data?.syncRunning}
                data-testid="button-meta-sync"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1 ${sync.isPending || status.data?.syncRunning ? "animate-spin" : ""}`}
                />
                {sync.isPending || status.data?.syncRunning ? "Syncing…" : "Refresh data"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm("Disconnect the Meta account? Historical data stays, but syncing stops."))
                    disconnectM.mutate();
                }}
                data-testid="button-meta-disconnect"
              >
                <Unlink className="h-4 w-4 mr-1" /> Disconnect
              </Button>
            </div>
          )}
        </div>

        {/* connection strip */}
        {status.isLoading ? (
          <Card className="border-border/40">
            <CardContent className="py-6 text-sm text-muted-foreground">Checking Meta connection…</CardContent>
          </Card>
        ) : !connected ? (
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Link2 className="h-5 w-5" /> Connect your Meta account
              </CardTitle>
              <CardDescription>
                Link the Facebook Page and Instagram account for E-Migration Assist to pull in
                real performance, audience, content, ad and lead data. Nothing is shown until a
                real account is connected — no sample numbers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!status.data?.appConfigured && (
                <p className="text-sm text-amber-400">
                  The Meta app credentials (META_APP_ID / META_APP_SECRET) are not configured yet —
                  connection is disabled until they are added.
                </p>
              )}
              <Button
                onClick={() => connect.mutate()}
                disabled={!status.data?.appConfigured || connect.isPending}
                data-testid="button-meta-connect"
              >
                <Facebook className="h-4 w-4 mr-2" /> Connect with Facebook
              </Button>
              {conn?.lastError && (
                <p className="text-xs text-destructive">Last error: {conn.lastError}</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/40">
            <CardContent className="py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <Facebook className="h-4 w-4 text-[#1877F2]" />
                {conn?.facebookPageName ?? "No Facebook page"}
              </span>
              <span className="flex items-center gap-2">
                <Instagram className="h-4 w-4 text-[#E4405F]" />
                {conn?.instagramUsername ? `@${conn.instagramUsername}` : "No Instagram account"}
              </span>
              {conn?.adAccountName && <span className="text-muted-foreground">Ads: {conn.adAccountName}</span>}
              <Badge variant={conn?.status === "active" ? "default" : conn?.status === "unverified" ? "secondary" : "destructive"}>
                {conn?.status === "active" ? "Connected" : conn?.status === "unverified" ? "Verifying" : conn?.status === "token_expired" ? "Reconnect needed" : conn?.status}
              </Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                Last synced: {conn?.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleString() : "never"}
              </span>
            </CardContent>
          </Card>
        )}

        {conn?.status === "token_expired" && (
          <Card className="border-destructive/40">
            <CardContent className="py-4 flex items-center justify-between gap-4 text-sm">
              <span>The Meta access token has expired. Reconnect to resume syncing.</span>
              <Button size="sm" onClick={() => connect.mutate()}>Reconnect</Button>
            </CardContent>
          </Card>
        )}

        {connected && !conn?.lastSyncedAt && conn?.lastError && (
          // First sync completed but with no progress — show the actual failure.
          <Card className="border-destructive/40 bg-red-950/20">
            <CardContent className="py-4 text-sm text-red-200 space-y-2">
              <p className="font-medium">Initial sync failed — no data was pulled in.</p>
              <p className="text-red-300/80">{conn.lastError}</p>
              <p className="text-red-400/60">
                Try clicking <strong>Refresh data</strong> above. If the error mentions permissions,
                check your Meta app roles and reconnect.
              </p>
            </CardContent>
          </Card>
        )}

        {connected && !conn?.lastSyncedAt && !conn?.lastError && (
          // No completed sync yet — either in progress or just connected.
          <Card className="border-blue-500/40 bg-blue-950/20">
            <CardContent className="py-4 flex items-center gap-3 text-sm">
              <RefreshCw className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
              <span className="text-blue-200">
                {status.data?.syncRunning
                  ? "Initial 90-day sync is running — this takes a few minutes. Data will appear once it completes."
                  : "Connected. Click Refresh data to pull in the last 90 days, or wait for the automatic sync."}
              </span>
            </CardContent>
          </Card>
        )}

        {connected && conn?.lastSyncedAt && conn?.lastError && (
          <Card className="border-amber-500/40 bg-amber-950/20">
            <CardContent className="py-4 text-sm text-amber-200">
              <span className="font-medium">
                {conn.lastError.startsWith("partial:") || conn.lastError.startsWith("permission_missing:")
                  ? "Partial sync — some metrics unavailable:"
                  : "Last sync warning:"}
              </span>{" "}
              {conn.lastError}
              {conn.lastError.includes("permission_missing:") && (
                <span className="text-amber-400/70">
                  {" "}— check that your Meta app role includes your account, then reconnect to re-request permissions.
                </span>
              )}
            </CardContent>
          </Card>
        )}

        {connected && (
          <>
            {/* filters */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger className="w-40" data-testid="select-meta-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
                <SelectTrigger className="w-40" data-testid="select-meta-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {range.from} → {range.to} · compared with the previous period
              </span>
            </div>

            <Tabs defaultValue="overview">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="audience">Audience</TabsTrigger>
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
                <TabsTrigger value="leads">Leads</TabsTrigger>
                <TabsTrigger value="conversions">Conversions</TabsTrigger>
                <TabsTrigger value="exports">Exports</TabsTrigger>
              </TabsList>

              {/* ── Overview ── */}
              <TabsContent value="overview" className="space-y-6 pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {(overview.data?.kpis ?? []).map((k) => (
                    <Card key={k.key} className="border-border/40">
                      <CardContent className="pt-4 pb-3 space-y-1">
                        <p className="text-xs text-muted-foreground">{k.label}</p>
                        {k.available ? (
                          <>
                            <p className="text-2xl font-semibold" data-testid={`kpi-${k.key}`}>
                              {fmt(k.current, k.format)}
                            </p>
                            <p className="text-xs flex items-center gap-1">
                              {k.changePct === null ? (
                                <span className="text-muted-foreground flex items-center gap-1"><Minus className="h-3 w-3" /> no comparison</span>
                              ) : k.changePct >= 0 ? (
                                <span className="text-emerald-400 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> +{k.changePct}%</span>
                              ) : (
                                <span className="text-red-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> {k.changePct}%</span>
                              )}
                              <span className="text-muted-foreground">vs previous</span>
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground pt-1">
                            Metric unavailable through Meta API
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {overview.isLoading && (
                    <p className="text-sm text-muted-foreground col-span-full">Loading metrics…</p>
                  )}
                </div>

                {/* trend chart */}
                <Card className="border-border/40">
                  <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                    <CardTitle className="text-base">Daily trend</CardTitle>
                    <Select value={chartMetric} onValueChange={setChartMetric}>
                      <SelectTrigger className="w-52" data-testid="select-meta-chart-metric">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(overview.data?.kpis ?? [])
                          .filter((k) => k.format !== "duration_ms")
                          .map((k) => (
                            <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </CardHeader>
                  <CardContent>
                    {series.data && !series.data.available ? (
                      <p className="text-sm text-muted-foreground py-10 text-center">
                        Metric unavailable through Meta API for this platform selection.
                      </p>
                    ) : (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={series.data?.series ?? []}>
                            <defs>
                              <linearGradient id="metaFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 20% 25%)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
                            <YAxis tick={{ fontSize: 11 }} width={48} />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(222 47% 11%)",
                                border: "1px solid hsl(217 20% 25%)",
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="hsl(217 91% 60%)"
                              fill="url(#metaFill)"
                              strokeWidth={2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Audience ── */}
              <TabsContent value="audience" className="space-y-4 pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "New follows", v: audience.data?.follows },
                    { label: "Unfollows", v: audience.data?.unfollows },
                    { label: "Net growth", v: audience.data?.netFollows },
                    { label: "Reach", v: audience.data?.reach },
                  ].map((k) => (
                    <Card key={k.label} className="border-border/40">
                      <CardContent className="pt-4 pb-3 space-y-1">
                        <p className="text-xs text-muted-foreground">{k.label}</p>
                        {k.v === null || k.v === undefined ? (
                          <p className="text-sm text-muted-foreground pt-1">
                            Metric unavailable through Meta API
                          </p>
                        ) : (
                          <p className="text-2xl font-semibold">{k.v.toLocaleString()}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="border-border/40">
                  <CardHeader>
                    <CardTitle className="text-base">Followers by country (Instagram)</CardTitle>
                    <CardDescription>
                      {audience.data?.demographics.asOf
                        ? `Lifetime snapshot as of ${audience.data.demographics.asOf}`
                        : "Demographics unavailable — Meta only exposes them for accounts with ≥100 followers."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {audience.data?.demographics.country ? (
                      <div className="space-y-2">
                        {Object.entries(audience.data.demographics.country)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 10)
                          .map(([country, count]) => {
                            const max = Math.max(...Object.values(audience.data!.demographics.country!));
                            return (
                              <div key={country} className="flex items-center gap-3 text-sm">
                                <span className="w-24 shrink-0">{country}</span>
                                <div className="flex-1 bg-border/30 rounded h-2">
                                  <div
                                    className="bg-primary h-2 rounded"
                                    style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
                                  />
                                </div>
                                <span className="w-12 text-right text-muted-foreground">{count}</span>
                              </div>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Metric unavailable through Meta API</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Content ── */}
              <TabsContent value="content" className="pt-4">
                <Card className="border-border/40">
                  <CardHeader>
                    <CardTitle className="text-base">Top content (by engagement)</CardTitle>
                    <CardDescription>Posts, reels and videos published in the selected period.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {content.data?.items.length ? (
                      <div className="divide-y divide-border/40">
                        {content.data.items.slice(0, 30).map((c) => (
                          <div key={String(c.id)} className="py-3 flex items-center gap-4 text-sm">
                            {c.thumbnailUrl ? (
                              <img
                                src={String(c.thumbnailUrl)}
                                alt=""
                                className="h-12 w-12 rounded object-cover shrink-0"
                              />
                            ) : (
                              <div className="h-12 w-12 rounded bg-border/30 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate">{String(c.caption ?? "(no caption)")}</p>
                              <p className="text-xs text-muted-foreground">
                                {String(c.platform)} · {String(c.contentType)} ·{" "}
                                {c.publishedAt ? new Date(String(c.publishedAt)).toLocaleDateString() : "—"}
                              </p>
                            </div>
                            <div className="text-xs text-muted-foreground text-right shrink-0 space-y-0.5">
                              <p>{c.views !== null && c.views !== undefined ? `${Number(c.views).toLocaleString()} views` : "views —"}</p>
                              <p>
                                {String(c.likes ?? "—")} likes · {String(c.comments ?? "—")} comments
                              </p>
                            </div>
                            {c.permalink ? (
                              <a
                                href={String(c.permalink)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary shrink-0"
                              >
                                View
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {content.isLoading ? "Loading content…" : "No content found for this period. Run a refresh after publishing."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Campaigns ── */}
              <TabsContent value="campaigns" className="space-y-4 pt-4">
                {campaigns.data?.campaigns.length ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {Object.entries(campaigns.data.totals).map(([k, v]) => (
                        <Card key={k} className="border-border/40">
                          <CardContent className="pt-4 pb-3">
                            <p className="text-xs text-muted-foreground capitalize">{k}</p>
                            <p className="text-lg font-semibold">
                              {k === "spend" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toLocaleString()}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <Card className="border-border/40">
                      <CardContent className="pt-4 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-muted-foreground border-b border-border/40">
                              <th className="py-2 pr-3">Campaign</th>
                              <th className="py-2 pr-3">Status</th>
                              <th className="py-2 pr-3">Objective</th>
                              <th className="py-2 pr-3 text-right">Spend</th>
                              <th className="py-2 pr-3 text-right">Impressions</th>
                              <th className="py-2 pr-3 text-right">Clicks</th>
                              <th className="py-2 pr-3 text-right">CTR</th>
                              <th className="py-2 pr-3 text-right">Leads</th>
                              <th className="py-2 text-right">Cost/lead</th>
                            </tr>
                          </thead>
                          <tbody>
                            {campaigns.data.campaigns.map((c) => (
                              <tr key={String(c.id)} className="border-b border-border/20">
                                <td className="py-2 pr-3">{String(c.name)}</td>
                                <td className="py-2 pr-3">
                                  <Badge variant="outline" className="text-xs">{String(c.status ?? "—")}</Badge>
                                </td>
                                <td className="py-2 pr-3 text-xs text-muted-foreground">{String(c.objective ?? "—")}</td>
                                <td className="py-2 pr-3 text-right">{c.spend !== null && c.spend !== undefined ? Number(c.spend).toFixed(2) : "—"}</td>
                                <td className="py-2 pr-3 text-right">{c.impressions !== null && c.impressions !== undefined ? Number(c.impressions).toLocaleString() : "—"}</td>
                                <td className="py-2 pr-3 text-right">{c.clicks !== null && c.clicks !== undefined ? Number(c.clicks).toLocaleString() : "—"}</td>
                                <td className="py-2 pr-3 text-right">{c.ctr !== null && c.ctr !== undefined ? `${Number(c.ctr).toFixed(2)}%` : "—"}</td>
                                <td className="py-2 pr-3 text-right">{String(c.leads ?? "—")}</td>
                                <td className="py-2 text-right">{c.costPerLead !== null && c.costPerLead !== undefined ? Number(c.costPerLead).toFixed(2) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-xs text-muted-foreground pt-3">
                          Ad figures are Meta-reported campaign-lifetime aggregates, refreshed on every sync.
                        </p>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="border-border/40">
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      {campaigns.isLoading
                        ? "Loading campaigns…"
                        : "No ad campaigns found. Either no ad account is linked or no campaigns have run yet."}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Leads ── */}
              <TabsContent value="leads" className="pt-4">
                <Card className="border-border/40">
                  <CardHeader>
                    <CardTitle className="text-base">Meta lead form submissions</CardTitle>
                    <CardDescription>
                      Every submission is also created in the Leads Centre automatically (source: Meta) —
                      duplicates link to the existing lead instead of creating a second record.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    {leads.data?.leads.length ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b border-border/40">
                            <th className="py-2 pr-3">Name</th>
                            <th className="py-2 pr-3">Email</th>
                            <th className="py-2 pr-3">Phone</th>
                            <th className="py-2 pr-3">Platform</th>
                            <th className="py-2 pr-3">Campaign</th>
                            <th className="py-2 pr-3">Received</th>
                            <th className="py-2">CRM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leads.data.leads.map((l) => (
                            <tr key={String(l.id)} className="border-b border-border/20">
                              <td className="py-2 pr-3">{String(l.fullName ?? "—")}</td>
                              <td className="py-2 pr-3 text-xs">{String(l.email ?? "—")}</td>
                              <td className="py-2 pr-3 text-xs">{String(l.phone ?? "—")}</td>
                              <td className="py-2 pr-3 text-xs capitalize">{String(l.platform)}</td>
                              <td className="py-2 pr-3 text-xs">{String(l.campaignName ?? l.metaCampaignId ?? "—")}</td>
                              <td className="py-2 pr-3 text-xs">
                                {l.metaCreatedAt ? new Date(String(l.metaCreatedAt)).toLocaleString() : "—"}
                              </td>
                              <td className="py-2">
                                <Badge variant="outline" className="text-xs">
                                  {String(l.importStatus ?? "pending")}
                                  {l.crmStatus ? ` · ${String(l.crmStatus)}` : ""}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {leads.isLoading ? "Loading leads…" : "No Meta lead submissions in this period."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Conversions ── */}
              <TabsContent value="conversions" className="space-y-4 pt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="border-border/40">
                    <CardHeader>
                      <CardTitle className="text-base">Internal (CRM)</CardTitle>
                      <CardDescription>Outcomes tracked in your own Leads Centre.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between"><span>Meta leads received</span><span className="font-semibold">{conversions.data?.internal.metaLeads ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Qualified or further</span><span className="font-semibold">{conversions.data?.internal.qualifiedLeads ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Converted</span><span className="font-semibold">{conversions.data?.internal.convertedLeads ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Conversion rate</span><span className="font-semibold">{conversions.data?.internal.conversionRate !== null && conversions.data?.internal.conversionRate !== undefined ? `${conversions.data.internal.conversionRate}%` : "—"}</span></div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/40">
                    <CardHeader>
                      <CardTitle className="text-base">Meta-reported (Ads)</CardTitle>
                      <CardDescription>Campaign-lifetime figures as reported by Meta — labelled separately, never mixed with CRM numbers.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between"><span>Spend</span><span className="font-semibold">{conversions.data?.metaReported.spend?.toLocaleString() ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Impressions</span><span className="font-semibold">{conversions.data?.metaReported.impressions?.toLocaleString() ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Clicks</span><span className="font-semibold">{conversions.data?.metaReported.clicks?.toLocaleString() ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Leads (Meta-attributed)</span><span className="font-semibold">{conversions.data?.metaReported.leads ?? "—"}</span></div>
                      <div className="flex justify-between"><span>Cost per lead</span><span className="font-semibold">{conversions.data?.metaReported.costPerLead ?? "—"}</span></div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* ── Exports ── */}
              <TabsContent value="exports" className="pt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    { kind: "campaigns", title: "Campaign performance", desc: "All campaigns with spend, reach, clicks, leads and costs." },
                    { kind: "leads", title: "Meta leads", desc: "Lead form submissions in the selected date range." },
                    { kind: "content", title: "Content insights", desc: "Post/reel performance in the selected date range." },
                    { kind: "daily", title: "Daily metrics", desc: "Raw day-by-day metric values for the selected range." },
                  ].map((e) => (
                    <Card key={e.kind} className="border-border/40">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Download className="h-4 w-4" /> {e.title}
                        </CardTitle>
                        <CardDescription>{e.desc}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button size="sm" onClick={() => download(e.kind)} data-testid={`button-meta-export-${e.kind}`}>
                          Download CSV
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
