import { Card } from "@/components/ui/card";
import type { DashboardKpis } from "@/lib/leadSegment";

type Quick = "none" | "hot" | "overdue" | "converted";

const CARDS: ReadonlyArray<{
  key: keyof DashboardKpis;
  label: string;
  hint: string;
  accent: string;
  ring: string;
  quick: Quick | null;
}> = [
  {
    key: "overdueSla",
    label: "Overdue SLA",
    hint: "Follow-up date has passed",
    accent: "text-rose-600",
    ring: "bg-rose-50 text-rose-600",
    quick: "overdue",
  },
  {
    key: "hot",
    label: "Hot",
    hint: "Top-scoring leads to action first",
    accent: "text-orange-600",
    ring: "bg-orange-50 text-orange-600",
    quick: "hot",
  },
  {
    key: "newToday",
    label: "New Today",
    hint: "Captured since midnight",
    accent: "text-[#2764F0]",
    ring: "bg-blue-50 text-[#2764F0]",
    quick: null,
  },
  {
    key: "inProgress",
    label: "In Progress",
    hint: "Active in the funnel",
    accent: "text-[#0B1F4D]",
    ring: "bg-slate-100 text-[#0B1F4D]",
    quick: null,
  },
];

const ICONS: Record<keyof DashboardKpis, string> = {
  overdueSla: "⏰",
  hot: "🔥",
  newToday: "✨",
  inProgress: "📈",
};

/**
 * Top KPI strip. Cards with an associated quick-filter act as buttons that
 * scope the leads table (Overdue SLA, Hot); the rest are read-only counters.
 */
export function KpiStrip({
  kpis,
  activeQuick,
  onQuick,
}: {
  kpis: DashboardKpis;
  activeQuick?: Quick;
  onQuick?: (quick: Quick) => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      data-testid="dashboard-kpi-strip"
    >
      {CARDS.map((card) => {
        const value = kpis[card.key];
        const clickable = card.quick !== null && !!onQuick;
        const active = clickable && activeQuick === card.quick;
        const content = (
          <Card
            className={`flex items-center justify-between gap-3 p-4 transition-colors ${
              clickable ? "cursor-pointer hover:border-[#2764F0]/50" : ""
            } ${active ? "border-[#2764F0] ring-1 ring-[#2764F0]/30" : ""}`}
            data-testid={`dashboard-kpi-${card.key}`}
          >
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {card.label}
              </div>
              <div className={`mt-1 text-3xl font-bold ${card.accent}`}>
                {value}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {card.hint}
              </div>
            </div>
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg ${card.ring}`}
              aria-hidden
            >
              {ICONS[card.key]}
            </div>
          </Card>
        );
        if (!clickable) return <div key={card.key}>{content}</div>;
        return (
          <button
            key={card.key}
            type="button"
            className="text-left"
            aria-pressed={active}
            onClick={() => onQuick?.(active ? "none" : card.quick!)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
