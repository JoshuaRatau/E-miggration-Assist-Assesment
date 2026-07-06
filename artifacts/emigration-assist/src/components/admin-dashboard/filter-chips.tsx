import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BRAND } from "@/lib/leadSegment";

// ---------------------------------------------------------------------------
// Lead Intelligence Dashboard v2 — Phase 2 filter chip bar.
//
// A compact toolbar that sits directly above the operational leads table
// (admin_mockup_v2). Every chip drives client-side state already held in
// admin.tsx and narrows the already-fetched leads dataset — no new endpoint,
// no schema change. The SLA legend is informational only (decodes the SLA
// column's colour states).
// ---------------------------------------------------------------------------

export type TimeRange = "all" | "today" | "7d" | "30d";
export type OwnerFilter = "all" | "assigned" | "unassigned";

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const OWNER_LABELS: Record<OwnerFilter, string> = {
  all: "Owner: Any",
  assigned: "Owner: Assigned",
  unassigned: "Owner: Unassigned",
};

interface FilterChipsProps {
  timeRange: TimeRange;
  onTimeRange: (v: TimeRange) => void;
  scoreMin80: boolean;
  onScoreMin80: (v: boolean) => void;
  owner: OwnerFilter;
  onOwner: (v: OwnerFilter) => void;
  source: string;
  onSource: (v: string) => void;
  sourceOptions: { value: string; label: string }[];
  country: string;
  onCountry: (v: string) => void;
  countryOptions: string[];
  // Phase 11C — "Assigned To" filter. `assignee` is "ALL" (any), "UNASSIGNED",
  // or an admin-user id. Options come from the shared assignable-users roster.
  assignee: string;
  onAssignee: (v: string) => void;
  assigneeOptions: { id: string; label: string }[];
}

const CHIP_TRIGGER =
  "h-8 rounded-full border-muted-foreground/25 bg-background px-3 text-xs font-medium shadow-none data-[state=open]:border-[#2764F0] focus:ring-1 focus:ring-[#2764F0]/40";

export function FilterChips({
  timeRange,
  onTimeRange,
  scoreMin80,
  onScoreMin80,
  owner,
  onOwner,
  source,
  onSource,
  sourceOptions,
  country,
  onCountry,
  countryOptions,
  assignee,
  onAssignee,
  assigneeOptions,
}: FilterChipsProps) {
  const assigneeLabel =
    assignee === "ALL"
      ? "Assigned to: Any"
      : assignee === "UNASSIGNED"
        ? "Assigned to: Unassigned"
        : `Assigned to: ${assigneeOptions.find((o) => o.id === assignee)?.label ?? "—"}`;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="lead-filter-chips"
    >
      {/* All time */}
      <Select
        value={timeRange}
        onValueChange={(v) => onTimeRange(v as TimeRange)}
      >
        <SelectTrigger
          className={`w-auto gap-1.5 ${CHIP_TRIGGER}`}
          data-testid="chip-time-range"
        >
          <SelectValue>{TIME_RANGE_LABELS[timeRange]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((k) => (
            <SelectItem key={k} value={k}>
              {TIME_RANGE_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Score >= 80 toggle */}
      <button
        type="button"
        onClick={() => onScoreMin80(!scoreMin80)}
        aria-pressed={scoreMin80}
        data-testid="chip-score-80"
        className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
          scoreMin80
            ? "border-transparent text-white"
            : "border-muted-foreground/25 bg-background text-foreground hover:bg-muted/50"
        }`}
        style={scoreMin80 ? { backgroundColor: BRAND.royal } : undefined}
      >
        Score ≥ 80
      </button>

      {/* Owner */}
      <Select value={owner} onValueChange={(v) => onOwner(v as OwnerFilter)}>
        <SelectTrigger
          className={`w-auto gap-1.5 ${CHIP_TRIGGER}`}
          data-testid="chip-owner"
        >
          <SelectValue>{OWNER_LABELS[owner]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(OWNER_LABELS) as OwnerFilter[]).map((k) => (
            <SelectItem key={k} value={k}>
              {OWNER_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Assigned To (Phase 11C) */}
      <Select value={assignee} onValueChange={onAssignee}>
        <SelectTrigger
          className={`w-auto gap-1.5 ${CHIP_TRIGGER}`}
          data-testid="chip-assignee"
        >
          <SelectValue>{assigneeLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Assigned to: Any</SelectItem>
          <SelectItem value="UNASSIGNED">Assigned to: Unassigned</SelectItem>
          {assigneeOptions.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Source */}
      <Select value={source} onValueChange={onSource}>
        <SelectTrigger
          className={`w-auto gap-1.5 ${CHIP_TRIGGER}`}
          data-testid="chip-source"
        >
          <SelectValue>
            {source === "ANY"
              ? "Source: Any"
              : (sourceOptions.find((o) => o.value === source)?.label ??
                "Source")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ANY">Source: Any</SelectItem>
          {sourceOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Country */}
      <Select value={country} onValueChange={onCountry}>
        <SelectTrigger
          className={`w-auto gap-1.5 ${CHIP_TRIGGER}`}
          data-testid="chip-country"
        >
          <SelectValue>
            {country === "ANY" ? "Country: Any" : country}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ANY">Country: Any</SelectItem>
          {countryOptions.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* SLA legend */}
      <div
        className="ml-auto flex items-center gap-3 rounded-full border border-muted-foreground/15 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground"
        data-testid="chip-sla-legend"
      >
        <span className="font-medium uppercase tracking-wide">SLA</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Overdue
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Due today
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          On track
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          Not set / closed
        </span>
      </div>
    </div>
  );
}
