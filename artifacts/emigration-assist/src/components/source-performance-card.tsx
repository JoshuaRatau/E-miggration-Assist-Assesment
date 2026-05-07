import { useGetStatsSourceMix } from "@workspace/api-client-react";
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
import { normalizeLeadSource } from "@/lib/leadSource";

// Phase 3 — Source Performance card.
//
// Renders the `/stats/source-mix` payload as a compact table: one row
// per channel with Leads / Last 30d / Converted / Conv%. The
// percentage is computed client-side (server returns raw counts) so
// the rounding rule is colocated with the rest of the UI.
//
// The card is intentionally read-only and uses the same dark-pill
// styling as the rest of the dashboard so it slots in alongside
// LeadMixCharts without a visual seam.

function formatPct(num: number, denom: number): string {
  if (denom <= 0) return "—";
  const pct = (num / denom) * 100;
  // One decimal place is enough at the volumes we see; integer
  // rounding hides the difference between e.g. 12 → 13 conversions.
  return `${pct.toFixed(1)}%`;
}

export function SourcePerformanceCard() {
  const { data, isLoading, error } = useGetStatsSourceMix();

  return (
    <Card data-testid="card-source-performance">
      <CardHeader>
        <CardTitle>Source Performance</CardTitle>
        <CardDescription>
          Lead volume and conversion rate per attribution channel. Last 30
          days highlights momentum vs total history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {error && (
          <p className="text-sm text-red-300">Failed to load source mix.</p>
        )}
        {data && data.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No leads yet.</p>
        )}
        {data && data.rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Last 30d</TableHead>
                <TableHead className="text-right">Converted</TableHead>
                <TableHead className="text-right">Conv. rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const source = normalizeLeadSource(row.source);
                return (
                  <TableRow
                    key={source}
                    data-testid={`source-row-${source}`}
                    data-source={source}
                  >
                    <TableCell>
                      <LeadSourceBadge source={source} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.leads}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.last30d}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.converted}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(row.converted, row.leads)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-testid="source-total-leads"
                >
                  {data.totals.leads}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {data.totals.last30d}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {data.totals.converted}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPct(data.totals.converted, data.totals.leads)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
