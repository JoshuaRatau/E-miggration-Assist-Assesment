import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  useGetStatsLeadMix,
  getGetStatsLeadMixQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

// Human-readable labels for each canonical bucket key returned by the
// `/api/stats/lead-mix` endpoint. Anything we don't have a label for
// (e.g. a typo backfilled into the DB) just falls back to a Title-Cased
// version of the raw key so it still renders, instead of silently being
// dropped.
const INDIVIDUAL_LABELS: Record<string, string> = {
  visa_inquiry: "Visa Inquiry",
  overstay_appeal: "Overstay Appeal",
  travel_entry_assistance: "Travel / Entry Assistance",
  unspecified: "Unspecified",
};

const PROFESSIONAL_LABELS: Record<string, string> = {
  law_firm: "Law Firm",
  immigration_consultancy: "Immigration Consultancy",
  global_mobility: "Global Mobility",
  independent_practitioner: "Independent Practitioner",
  unspecified: "Unspecified",
};

// Palette pulled from the dashboard navy/teal/amber accent set so the
// charts read as part of the same surface rather than a generic recharts
// rainbow. Each entry is a CSS colour string so it can be passed straight
// into <Cell fill={...}> / <Bar fill={...}>.
const PROFESSIONAL_COLORS = [
  "#2dd4bf", // teal-400
  "#60a5fa", // blue-400
  "#fbbf24", // amber-400
  "#a78bfa", // violet-400
  "#94a3b8", // slate-400 (fallback / unspecified)
];

const INDIVIDUAL_BAR_COLOR = "#2dd4bf";

function titleCase(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function relabel(
  buckets: { bucket: string; count: number }[],
  labels: Record<string, string>,
) {
  return buckets.map((b) => ({
    name: labels[b.bucket] ?? titleCase(b.bucket),
    value: b.count,
    rawKey: b.bucket,
  }));
}

export function LeadMixCharts() {
  // refetchInterval keeps the dashboard "live" without forcing a full
  // refresh; 60s is comfortably faster than an operator's eyeball cadence
  // and slow enough to avoid hammering the DB during long admin sessions.
  const { data, isLoading, isError } = useGetStatsLeadMix({
    query: {
      queryKey: getGetStatsLeadMixQueryKey(),
      refetchInterval: 60_000,
    },
  });

  const individualsData = data
    ? relabel(data.individuals.buckets, INDIVIDUAL_LABELS)
    : [];
  const professionalsData = data
    ? relabel(data.professionals.buckets, PROFESSIONAL_LABELS)
    : [];

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="lead-mix-charts">
      <Card data-testid="lead-mix-individuals">
        <CardHeader className="pb-2">
          <CardDescription>Individual leads · all-time inquiry mix</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {data?.individuals.total ?? 0}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            {isLoading ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : isError ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-destructive">
                Failed to load lead mix.
              </div>
            ) : individualsData.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                No individual leads yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={individualsData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "currentColor", opacity: 0.7 }}
                    interval={0}
                    height={48}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "currentColor", opacity: 0.7 }}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{
                      background: "hsl(222 47% 11%)",
                      border: "1px solid hsl(217 33% 24%)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Bar
                    dataKey="value"
                    fill={INDIVIDUAL_BAR_COLOR}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="lead-mix-professionals">
        <CardHeader className="pb-2">
          <CardDescription>
            Professional leads · all-time organisation mix
          </CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {data?.professionals.total ?? 0}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            {isLoading ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : isError ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-destructive">
                Failed to load lead mix.
              </div>
            ) : professionalsData.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                No professional leads yet — import a CSV to populate this view.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={professionalsData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={84}
                    paddingAngle={2}
                  >
                    {professionalsData.map((entry, idx) => (
                      <Cell
                        key={entry.rawKey}
                        fill={
                          PROFESSIONAL_COLORS[
                            idx % PROFESSIONAL_COLORS.length
                          ]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(222 47% 11%)",
                      border: "1px solid hsl(217 33% 24%)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconSize={10}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
