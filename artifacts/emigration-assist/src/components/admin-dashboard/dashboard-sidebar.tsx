import { Link } from "wouter";
import type {
  DashboardKpis,
  LeadSegment,
  SegmentCounts,
} from "@/lib/leadSegment";

type Quick = "none" | "hot" | "overdue" | "converted";

/**
 * Left navigation rail for the Lead Intelligence Dashboard v2.
 *
 * Two groups:
 *  - Workspace: client-side quick filters over the already-fetched leads
 *    (All / Hot / Overdue SLA / Converted).
 *  - Segments: mirrors the top toggle with live counts.
 *  - Operations: links to the existing admin modules.
 *
 * Hidden below lg; on smaller screens the top toggle + KPI cards remain the
 * primary controls.
 */
export function DashboardSidebar({
  segment,
  onSegment,
  quickFilter,
  onQuickFilter,
  counts,
  kpis,
}: {
  segment: LeadSegment;
  onSegment: (segment: LeadSegment) => void;
  quickFilter: Quick;
  onQuickFilter: (quick: Quick) => void;
  counts: SegmentCounts;
  kpis: DashboardKpis;
}) {
  const workspace: ReadonlyArray<{
    value: Quick;
    label: string;
    badge?: number;
  }> = [
    { value: "none", label: "All leads", badge: counts.all },
    { value: "hot", label: "Hot leads", badge: kpis.hot },
    { value: "overdue", label: "Overdue SLA", badge: kpis.overdueSla },
    { value: "converted", label: "Converted" },
  ];

  const segments: ReadonlyArray<{
    value: LeadSegment;
    label: string;
    badge: number;
  }> = [
    { value: "all", label: "All", badge: counts.all },
    { value: "individual", label: "Individual", badge: counts.individual },
    { value: "overstay", label: "Overstay", badge: counts.overstay },
    { value: "business", label: "Business", badge: counts.business },
  ];

  const operations: ReadonlyArray<{ href: string; label: string }> = [
    { href: "/admin/communications", label: "Communications" },
    { href: "/admin/import", label: "Imports" },
    { href: "/admin/exports", label: "Exports" },
    { href: "/admin/users", label: "Team" },
  ];

  return (
    <aside
      className="hidden w-60 shrink-0 lg:block"
      data-testid="dashboard-sidebar"
    >
      <div className="sticky top-20 space-y-6 rounded-xl border bg-card p-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[#2764F0]">
            Lead Intelligence
          </div>
          <div className="mt-0.5 text-sm font-semibold text-[#0B1F4D]">
            Workspace
          </div>
        </div>

        <nav className="space-y-1" aria-label="Workspace filters">
          {workspace.map((item) => {
            const active = quickFilter === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onQuickFilter(item.value)}
                aria-pressed={active}
                data-testid={`sidebar-quick-${item.value}`}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[#2764F0]/10 font-medium text-[#2764F0]"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <span>{item.label}</span>
                {typeof item.badge === "number" && (
                  <span className="text-xs font-semibold">{item.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div>
          <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Segments
          </div>
          <nav className="space-y-1" aria-label="Segments">
            {segments.map((item) => {
              const active = segment === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onSegment(item.value)}
                  aria-pressed={active}
                  data-testid={`sidebar-segment-${item.value}`}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-[#0B1F4D] font-medium text-white"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {item.value === "overstay" && item.badge > 0 && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                        aria-hidden
                      />
                    )}
                    {item.label}
                  </span>
                  <span className="text-xs font-semibold">{item.badge}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Operations
          </div>
          <nav className="space-y-1" aria-label="Operations">
            {operations.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                data-testid={`sidebar-link-${item.label.toLowerCase()}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </aside>
  );
}
