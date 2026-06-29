import type { LeadSegment, SegmentCounts } from "@/lib/leadSegment";

const SEGMENTS: ReadonlyArray<{
  value: LeadSegment;
  label: string;
  countKey: keyof SegmentCounts;
}> = [
  { value: "all", label: "All", countKey: "all" },
  { value: "individual", label: "Individual", countKey: "individual" },
  { value: "overstay", label: "Overstay", countKey: "overstay" },
  { value: "business", label: "Business", countKey: "business" },
];

/**
 * 4-way operator segment toggle with live counts. The Overstay tab carries an
 * amber alert pill whenever there are overstay leads, since that population is
 * time-sensitive and the centrepiece of the v2 dashboard.
 */
export function SegmentToggle({
  segment,
  onChange,
  counts,
}: {
  segment: LeadSegment;
  onChange: (segment: LeadSegment) => void;
  counts: SegmentCounts;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-1.5"
      role="tablist"
      aria-label="Lead segment"
      data-testid="dashboard-segment-toggle"
    >
      {SEGMENTS.map((seg) => {
        const active = segment === seg.value;
        const count = counts[seg.countKey];
        const isOverstay = seg.value === "overstay";
        return (
          <button
            key={seg.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(seg.value)}
            data-testid={`dashboard-segment-${seg.value}`}
            className={`group inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-[#2764F0] text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            <span>{seg.label}</span>
            <span
              className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                active
                  ? "bg-white/20 text-white"
                  : "bg-muted text-muted-foreground group-hover:bg-background"
              }`}
              data-testid={`dashboard-segment-count-${seg.value}`}
            >
              {count}
            </span>
            {isOverstay && count > 0 && (
              <span
                className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                title="Overstay leads need time-sensitive attention"
                data-testid="dashboard-segment-overstay-alert"
              >
                ⚠ Alert
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
