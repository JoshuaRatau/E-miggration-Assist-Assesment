import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
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
import { LeadSourceBadge } from "@/components/lead-source-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { normalizeLeadSource } from "@/lib/leadSource";
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  AlertTriangle,
  BarChart3,
  Table as TableIcon,
} from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Phase 6E — Source attribution intelligence.
//
// This card is the dashboard's executive surface for understanding where
// leads come from and how each channel is trending. It pairs the original
// table view with:
//   - time range selector (7d / 30d / 1m / 3m / 6m / All)
//   - segment filter (All / Travellers / Firms)
//   - table ↔ graph toggle
//   - multi-line trend chart with smooth curves and gradients
//   - auto-derived insights panel.

type RangeKey = "7d" | "30d" | "1m" | "3m" | "6m" | "all";
type SegmentKey = "all" | "b2c" | "b2b";
type ViewKey = "table" | "graph";

const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "7d",
  "30d": "30d",
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  all: "All",
};

const SEGMENT_LABELS: Record<SegmentKey, string> = {
  all: "All",
  b2c: "Travellers",
  b2b: "Firms",
};

interface AttributionRow {
  source: string;
  label: string;
  leads: number;
  converted: number;
  conversionPct: number;
  growthPct: number | null;
}

interface AttributionResponse {
  range: RangeKey;
  segment: SegmentKey;
  bucket: "day" | "week" | "month";
  rows: AttributionRow[];
  totals: { leads: number; converted: number; conversionPct: number };
  series: Array<Record<string, string | number>>;
  insights: Array<{ tone: "positive" | "neutral" | "warning"; text: string }>;
}

// Premium SaaS palette — corporate teals, muted cyan, indigo, amber. Avoid
// neon. Sources cycle through this list deterministically based on their
// position in the rows array (top-volume gets the most prominent colour).
const CHART_COLORS = [
  "#2dd4bf", // teal-400
  "#38bdf8", // sky-400
  "#a78bfa", // violet-400
  "#fbbf24", // amber-400
  "#34d399", // emerald-400
  "#f472b6", // pink-400
  "#818cf8", // indigo-400
  "#fb923c", // orange-400
  "#94a3b8", // slate-400
  "#f87171", // rose-400 — reserved for "other" / fallbacks
];

function formatPct(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatBucket(date: string, bucket: "day" | "week" | "month"): string {
  const d = new Date(date + "T00:00:00Z");
  if (bucket === "month") {
    return d.toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function fetchAttribution(
  range: RangeKey,
  segment: SegmentKey,
): Promise<AttributionResponse> {
  const url = `${BASE}/api/stats/source-attribution?range=${range}&segment=${segment}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function SourcePerformanceCard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [view, setView] = useState<ViewKey>("table");

  const { data, isLoading, error } = useQuery({
    queryKey: ["source-attribution", range, segment],
    queryFn: () => fetchAttribution(range, segment),
    staleTime: 30_000,
  });

  // Stable colour assignment per source — keyed on position in the
  // initial rows array so a re-render with new data still keeps the
  // top-volume source in teal.
  const colorBySource = useMemo(() => {
    const map = new Map<string, string>();
    (data?.rows ?? []).forEach((r, i) => {
      map.set(r.source, CHART_COLORS[i % CHART_COLORS.length]!);
    });
    return map;
  }, [data?.rows]);

  return (
    <Card data-testid="card-source-performance" className="overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Source Performance</CardTitle>
            <CardDescription>
              Lead volume, conversion, and momentum per attribution channel.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border/40 bg-background/40 p-0.5">
            <button
              type="button"
              onClick={() => setView("table")}
              data-testid="view-toggle-table"
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                view === "table"
                  ? "bg-teal-500/20 text-teal-200"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              data-testid="view-toggle-graph"
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                view === "graph"
                  ? "bg-teal-500/20 text-teal-200"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Graph
            </button>
          </div>
        </div>

        {/* Controls row — range pills + segment toggle. */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div
            className="flex items-center gap-1 rounded-md border border-border/40 bg-background/40 p-0.5"
            data-testid="range-selector"
          >
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                data-testid={`range-${k}`}
                className={`rounded px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  range === k
                    ? "bg-teal-500/20 text-teal-200"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
          <div
            className="flex items-center gap-1 rounded-md border border-border/40 bg-background/40 p-0.5"
            data-testid="segment-selector"
          >
            {(Object.keys(SEGMENT_LABELS) as SegmentKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSegment(k)}
                data-testid={`segment-${k}`}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  segment === k
                    ? "bg-sky-500/20 text-sky-200"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {SEGMENT_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Top-line stat strip — always visible regardless of view. */}
        {data ? (
          <div className="grid grid-cols-3 gap-3" data-testid="totals-strip">
            <StatTile
              label="Total leads"
              value={data.totals.leads.toLocaleString()}
              tone="slate"
            />
            <StatTile
              label="Converted"
              value={data.totals.converted.toLocaleString()}
              tone="emerald"
            />
            <StatTile
              label="Overall conv. rate"
              value={`${data.totals.conversionPct.toFixed(1)}%`}
              tone="teal"
            />
          </div>
        ) : null}

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {error && (
          <p className="text-sm text-red-300">
            Failed to load source attribution.
          </p>
        )}

        {data && data.rows.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No leads in this window yet. Try widening the time range or
            switching segment.
          </p>
        )}

        {data && data.rows.length > 0 && view === "graph" && (
          <TrendChart
            data={data}
            colorBySource={colorBySource}
            bucket={data.bucket}
          />
        )}

        {data && data.rows.length > 0 && view === "table" && (
          <Table data-testid="attribution-table">
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Converted</TableHead>
                <TableHead className="text-right">Conv. rate</TableHead>
                <TableHead className="text-right">Growth</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const normalized = normalizeLeadSource(row.source);
                return (
                  <TableRow
                    key={row.source}
                    data-testid={`source-row-${row.source}`}
                    data-source={row.source}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              colorBySource.get(row.source) ?? "#64748b",
                          }}
                        />
                        <LeadSourceBadge source={normalized} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {row.leads}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.converted}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.conversionPct.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <GrowthChip pct={row.growthPct} />
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-medium border-t-2 border-border/50">
                <TableCell>Total</TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-testid="source-total-leads"
                >
                  {data.totals.leads}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {data.totals.converted}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {data.totals.conversionPct.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  —
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}

        {/* Insights panel — auto-derived, no narrative AI needed. */}
        {data && data.insights.length > 0 ? (
          <div
            className="rounded-lg border border-border/40 bg-background/40 p-4"
            data-testid="insights-panel"
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-teal-300" />
              <h4 className="text-sm font-semibold tracking-tight">
                Insights
              </h4>
            </div>
            <ul className="space-y-2">
              {data.insights.map((insight, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm"
                  data-testid={`insight-${i}`}
                >
                  <InsightIcon tone={insight.tone} />
                  <span className="text-muted-foreground">
                    {insight.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "emerald" | "teal";
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "teal"
        ? "text-teal-300"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function GrowthChip({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (pct === 0) {
    return <span className="text-muted-foreground tabular-nums">0%</span>;
  }
  const positive = pct > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const cls = positive
    ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-300"
    : "border-rose-300/40 bg-rose-500/10 text-rose-300";
  return (
    <Badge
      variant="outline"
      className={`${cls} tabular-nums gap-1 font-medium`}
    >
      <Icon className="h-3 w-3" />
      {formatPct(pct)}
    </Badge>
  );
}

function InsightIcon({ tone }: { tone: "positive" | "neutral" | "warning" }) {
  if (tone === "positive")
    return <TrendingUp className="h-4 w-4 text-emerald-300 mt-0.5 flex-shrink-0" />;
  if (tone === "warning")
    return (
      <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" />
    );
  return <Sparkles className="h-4 w-4 text-sky-300 mt-0.5 flex-shrink-0" />;
}

function TrendChart({
  data,
  colorBySource,
  bucket,
}: {
  data: AttributionResponse;
  colorBySource: Map<string, string>;
  bucket: "day" | "week" | "month";
}) {
  // Cap legend to the top 6 sources by total volume — beyond that the
  // chart turns into spaghetti. Sources outside the top 6 still get
  // rendered as faint background lines for context, just unlabeled.
  const topSources = data.rows.slice(0, 6);
  const otherSources = data.rows.slice(6);

  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="h-[280px] w-full" data-testid="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data.series}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          >
            <defs>
              {topSources.map((s) => {
                const color = colorBySource.get(s.source) ?? "#64748b";
                return (
                  <linearGradient
                    key={s.source}
                    id={`grad-${s.source}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(148,163,184,0.12)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatBucket(d, bucket)}
              stroke="rgba(148,163,184,0.5)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis
              stroke="rgba(148,163,184,0.5)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15,23,42,0.95)",
                border: "1px solid rgba(148,163,184,0.3)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelFormatter={(d: string) => formatBucket(d, bucket)}
              formatter={(value: number, name: string) => {
                const row = data.rows.find((r) => r.source === name);
                return [value, row?.label ?? name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              formatter={(value: string) => {
                const row = data.rows.find((r) => r.source === value);
                return (
                  <span className="text-muted-foreground">
                    {row?.label ?? value}
                  </span>
                );
              }}
            />
            {/* Faint background lines for non-top sources. */}
            {otherSources.map((s) => (
              <Line
                key={s.source}
                type="monotone"
                dataKey={s.source}
                stroke={colorBySource.get(s.source) ?? "#64748b"}
                strokeOpacity={0.25}
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
            {/* Foreground top sources: smooth lines with gradient fill */}
            {topSources.map((s) => {
              const color = colorBySource.get(s.source) ?? "#64748b";
              return (
                <Area
                  key={`area-${s.source}`}
                  type="monotone"
                  dataKey={s.source}
                  stroke="none"
                  fill={`url(#grad-${s.source})`}
                  isAnimationActive={true}
                  legendType="none"
                />
              );
            })}
            {topSources.map((s) => {
              const color = colorBySource.get(s.source) ?? "#64748b";
              return (
                <Line
                  key={`line-${s.source}`}
                  type="monotone"
                  dataKey={s.source}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 0 }}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
