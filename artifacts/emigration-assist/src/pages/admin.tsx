import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { type Lead } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";
import { trackEvent } from "@/lib/analytics";
import {
  canAdvanceStatus,
  isStrictlyUpstreamOf,
  statusLabel,
} from "@/lib/leadStatus";
import { tierBadgeClass, tierLabel } from "@/lib/intendedTier";
import { funnelRouteLabel, funnelThemeLabel } from "@/lib/funnelContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminLayout } from "@/components/admin-layout";
import { LeadTimelineDialog } from "@/components/lead-timeline-dialog";
import { LeadPipelineBoard } from "@/components/lead-pipeline-board";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { HelpTooltip } from "@/components/help-tooltip";
import { enquiryCategoryLabel } from "@/lib/typeOfEnquiry";
import { derivePreferredCommunication } from "@/lib/preferredCommunication";
import { LeadSourceBadge } from "@/components/lead-source-badge";
import { LEAD_SOURCES, leadSourceMeta, normalizeLeadSource } from "@/lib/leadSource";
import { deriveLeadScore } from "@/lib/leadScore";
import {
  type LeadSegment,
  serverLeadTypeFor,
  isOverstayLead,
  segmentOfLead,
  isOverdueSla,
  isHotLead,
  computeKpis,
  computeSegmentCounts,
  criticalOverstayLeads,
} from "@/lib/leadSegment";
import { DashboardSidebar } from "@/components/admin-dashboard/dashboard-sidebar";
import { KpiStrip } from "@/components/admin-dashboard/kpi-strip";
import { SegmentToggle } from "@/components/admin-dashboard/segment-toggle";
import { CriticalAlertBanner } from "@/components/admin-dashboard/critical-alert-banner";
import { CommandSearchBar } from "@/components/admin-dashboard/command-search-bar";
import { LeadDrawer } from "@/components/admin-dashboard/lead-drawer";
import {
  FilterChips,
  type TimeRange,
  type OwnerFilter,
} from "@/components/admin-dashboard/filter-chips";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Lowercase canonical enums shared with the server (see classification.ts
// and lib/leadStatus.ts).  V2 added `ready_for_case` between qualified
// and converted; CRM Phase A added engaged and proposal_sent, plus
// `critical` above `high`. Phase 6A.1 dropped `awaiting_response` —
// the "I'm waiting" state is now expressed by `next_follow_up_at` on
// the `contacted` row, not its own stage. The funnel itself is
// bidirectional but converting still requires `ready_for_case`.
const STATUS_VALUES = [
  "new",
  "reviewing",
  "contacted",
  "engaged",
  "qualified",
  "proposal_sent",
  "ready_for_case",
  "converted",
  "closed",
] as const;
const PRIORITY_VALUES = ["critical", "high", "medium", "low"] as const;

const PRIORITY_OPTIONS = [
  { value: "ALL", label: "All priorities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "contacted", label: "Contacted" },
  { value: "engaged", label: "Engaged" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal_sent", label: "Proposal sent" },
  { value: "ready_for_case", label: "Ready for case" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

const WHATSAPP_OPTIONS = [
  { value: "ANY", label: "Channel: Any" },
  { value: "HAS", label: "Channel: WhatsApp reachable" },
  { value: "NONE", label: "Channel: Email / In-App only" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "priority", label: "Priority first (high → low)" },
  { value: "score", label: "Score (hottest first)" },
];

// Visual cues for the priority badge — critical = magenta-pink (urgency
// signal above HIGH), high = red, medium = orange, low = grey.
function priorityBadgeClass(priority: string | null | undefined): string {
  if (priority === "critical")
    return "bg-pink-700 hover:bg-pink-800 text-white border-transparent";
  if (priority === "high")
    return "bg-red-600 hover:bg-red-700 text-white border-transparent";
  if (priority === "medium")
    return "bg-orange-500 hover:bg-orange-600 text-white border-transparent";
  if (priority === "low")
    return "bg-gray-400 hover:bg-gray-500 text-white border-transparent";
  return "bg-muted text-muted-foreground border-transparent";
}

function priorityLabel(priority: string | null | undefined): string {
  if (priority === "critical") return "CRITICAL";
  if (priority === "high") return "HIGH";
  if (priority === "medium") return "MEDIUM";
  if (priority === "low") return "LOW";
  return "—";
}

// Order used by the "priority first" sort: critical > high > medium > low > unknown.
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function priorityRank(p: string | null | undefined): number {
  return p && p in PRIORITY_RANK ? PRIORITY_RANK[p]! : 99;
}

// Subtle row highlight for actionable statuses.  "new" leads need triage,
// "reviewing" leads are mid-triage and need to be contacted next — both
// represent inbox work the operator should clear.  We use a very light
// blue tint so it reads as "needs your attention" without overpowering the
// table's color cues (priority badges still pop).
function rowHighlightClass(status: string | null | undefined): string {
  if (status === "new" || status === "reviewing") {
    return "bg-blue-50/60 hover:bg-blue-100/60";
  }
  return "";
}

// Segment pill label + colour for the "Segment & Scenario" column.
function segmentLabel(
  s: "individual" | "overstay" | "business",
): string {
  return s === "business"
    ? "Business"
    : s === "overstay"
      ? "Overstay"
      : "Individual";
}

function segmentPillClass(
  s: "individual" | "overstay" | "business",
): string {
  if (s === "overstay") return "bg-amber-100 text-amber-800";
  if (s === "business") return "bg-indigo-100 text-indigo-800";
  return "bg-blue-100 text-blue-800";
}

// SLA pill for the leads table — decodes the lead's follow-up status into the
// colour states documented by the filter-chip SLA legend. Overdue uses
// `isOverdueSla` (which already excludes terminal statuses) so the cell and
// the "Overdue SLA" KPI never disagree.
function SlaPill({ lead }: { lead: Lead }) {
  const raw = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  if (!raw || Number.isNaN(raw.getTime())) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        data-testid={`sla-${lead.referenceNumber}`}
        data-sla="none"
      >
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        Not set
      </span>
    );
  }
  const now = new Date();
  const overdue = isOverdueSla(lead, now);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const isToday = !overdue && raw.getTime() <= endOfToday.getTime();
  const isPast = raw.getTime() < now.getTime();
  let dot = "bg-emerald-500";
  let label = "On track";
  let state = "on_track";
  if (overdue) {
    dot = "bg-amber-500";
    label = "Overdue";
    state = "overdue";
  } else if (isToday) {
    dot = "bg-blue-500";
    label = "Due today";
    state = "due_today";
  } else if (isPast) {
    // Past-due but non-overdue means a terminal lead — follow-up no longer
    // actionable, render neutrally rather than a misleading "On track".
    dot = "bg-muted-foreground/40";
    label = "Closed";
    state = "closed";
  }
  return (
    <span
      className="inline-flex flex-col gap-0.5 text-xs"
      data-testid={`sla-${lead.referenceNumber}`}
      data-sla={state}
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {format(raw, "MMM d")}
      </span>
    </span>
  );
}

// Conversion Engine V1 — outbound contact message template.
//
// Strict copy rules (per product spec): no payment CTA, no approval/rejection
// wording, no guarantees.  Use the lead's first name when available; fall
// back to "there" so we never render the literal `{{name}}` placeholder.
function buildContactMessage(
  fullName: string | null | undefined,
  referenceNumber: string,
): string {
  const trimmed = (fullName ?? "").trim();
  // First word only — keeps the salutation casual and avoids leaking surnames
  // into a copy-pasted WhatsApp/email body.
  const firstName = trimmed.length > 0 ? trimmed.split(/\s+/)[0] : "there";
  return (
    `Hi ${firstName}, this is E-Migration Assist. ` +
    `We received your assessment under reference ${referenceNumber}. ` +
    `We are reviewing the information submitted and may request ` +
    `additional details if needed.`
  );
}

// Build the best-available "Contact" deeplink for a lead.  Prefers WhatsApp
// when a number is on file (single-tap from desktop browsers via wa.me),
// falls back to email.  Returns null when neither is available so the
// button can be disabled with an explanatory tooltip.
//
// The message template is appended as `?text=` for wa.me and `?body=` for
// mailto so the operator opens a chat/draft pre-filled with the V1 copy.
function contactHref(
  email: string | null | undefined,
  whatsapp: string | null | undefined,
  message: string,
): { href: string; channel: "whatsapp" | "email" } | null {
  const encodedMessage = encodeURIComponent(message);
  if (typeof whatsapp === "string" && whatsapp.length > 0) {
    // wa.me requires a digits-only phone (no leading +).
    const digits = whatsapp.replace(/[^0-9]/g, "");
    if (digits.length > 0) {
      return {
        href: `https://wa.me/${digits}?text=${encodedMessage}`,
        channel: "whatsapp",
      };
    }
  }
  if (typeof email === "string" && email.length > 0) {
    return {
      href: `mailto:${email}?body=${encodedMessage}`,
      channel: "email",
    };
  }
  return null;
}

// (Funnel-regression guard for the Contact button is now derived from the
// shared `isStrictlyUpstreamOf(status, "contacted")` helper in
// lib/leadStatus.ts — keeps a single source of truth as the funnel grows.)

// "Type of Enquiry" — Phase 5 §5. Now derived from `lib/typeOfEnquiry`
// to span both B2C immigrationSituation/inquiryType and B2B fields.

export function Admin() {
  useEffect(() => {
    document.title = "Admin Overview | EMA Leads Funnel";
  }, []);

  const [priority, setPriority] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [whatsappFilter, setWhatsappFilter] = useState("ANY");
  const [sourceFilter, setSourceFilter] = useState("ANY");
  // Phase 5 — funnel route/context filter (client-side over fetched leads).
  // "ALL" = no narrowing. traveller/overstay_undesirable/firm_professional
  // match funnelContext.route; stuck_application matches funnelContext.theme.
  const [routeFilter, setRouteFilter] = useState<
    | "ALL"
    | "traveller"
    | "overstay_undesirable"
    | "firm_professional"
    | "stuck_application"
  >("ALL");
  const [sort, setSort] = useState<"newest" | "priority" | "score">("newest");
  // Soft-archive view. When true the leads list shows ONLY archived leads
  // (server filters via ?archived=true); when false it shows the active
  // funnel. `deleteTarget` drives a single page-level confirm dialog (same
  // no-per-row-portal pattern as sendUpdateTarget / timelineTarget).
  const [archivedView, setArchivedView] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    referenceNumber: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 4-way operator segment (Lead Intelligence v2). Persisted so an operator
  // returns to their last view. "overstay" is a client-side narrowing of
  // individuals; serverLeadTypeFor maps it back to the server's leadType.
  const [segment, setSegment] = useState<LeadSegment>(() => {
    if (typeof window === "undefined") return "all";
    const saved = window.localStorage.getItem("ema:admin:segment");
    return saved === "individual" ||
      saved === "overstay" ||
      saved === "business"
      ? (saved as LeadSegment)
      : "all";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ema:admin:segment", segment);
    }
  }, [segment]);
  const serverLeadType = serverLeadTypeFor(segment);

  // Sidebar / KPI quick filters + top search bar — all client-side over the
  // already-fetched leads.
  const [quickFilter, setQuickFilter] = useState<
    "none" | "hot" | "overdue" | "converted"
  >("none");
  const [search, setSearch] = useState("");

  // Phase 2 filter-chip state (client-side narrowing over fetched leads).
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [scoreMin80, setScoreMin80] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [countryFilter, setCountryFilter] = useState<string>("ANY");

  // Right-side lead drawer (placeholder content in Phase 1).
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);

  // Server-side filters that we forward to GET /api/leads.  WhatsApp is
  // applied client-side because the server contract has no filter for it
  // (`hasWhatsapp` is derived from the `whatsapp` field at serialization).
  const serverParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: 200 };
    if (priority !== "ALL") p.priority = priority;
    if (status !== "ALL") p.status = status;
    if (serverLeadType !== "ALL") p.leadType = serverLeadType;
    if (archivedView) p.archived = "true";
    return p;
  }, [priority, status, serverLeadType, archivedView]);

  // We can't use the Orval-generated `useListLeads` here because it does not
  // expose a way to inject the `x-admin-token` header that GET /api/leads now
  // requires.  We use React Query directly with a custom fetch and our own
  // query key — that key is also what `patchLead` mutates optimistically.
  const listQueryKey = useMemo(
    () => ["admin", "leads", serverParams] as const,
    [serverParams],
  );

  const { toast } = useToast();
  const qc = useQueryClient();
  // wouter setLocation — used by the Convert-to-Case quick action to deep-link
  // straight into /admin/case/:caseId after the conversion PATCH succeeds.
  const [, setLocation] = useLocation();

  const {
    data: leads,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Lead[], Error>({
    queryKey: listQueryKey,
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const url = new URL(
        `${(import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "")}/api/leads`,
        window.location.origin,
      );
      for (const [k, v] of Object.entries(serverParams)) {
        url.searchParams.set(k, String(v));
      }
      const res = await fetch(url.toString(), {
        credentials: "include",
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      return (await res.json()) as Lead[];
    },
  });

  // Dashboard-wide metrics dataset — ALL leads for the current archive view,
  // free of segment/status/priority filters so the KPI strip, segment counts
  // and critical-overstay banner stay stable as the operator narrows the
  // table. Limit matches the import wizard's 5000 cap.
  const metricsKey = useMemo(
    () =>
      ["admin", "metricsLeads", archivedView ? "archived" : "active"] as const,
    [archivedView],
  );
  const { data: metricsLeads } = useQuery<Lead[], Error>({
    queryKey: metricsKey,
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const url = new URL(
        `${(import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "")}/api/leads`,
        window.location.origin,
      );
      url.searchParams.set("limit", "5000");
      if (archivedView) url.searchParams.set("archived", "true");
      const res = await fetch(url.toString(), {
        credentials: "include",
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return (await res.json()) as Lead[];
    },
  });

  // Apply the WhatsApp filter and the optional priority sort on the client.
  // `hasWhatsapp` lives on the serialized payload; we fall back to checking
  // the raw `whatsapp` field for resilience against older payloads.
  const visibleLeads = useMemo(() => {
    if (!leads) return leads;
    let out = leads;
    // Overstay is a client-side narrowing of the server's individual rows;
    // Individual excludes overstay so the two tabs stay mutually exclusive.
    if (segment === "overstay") out = out.filter((l) => isOverstayLead(l));
    else if (segment === "individual")
      out = out.filter((l) => !isOverstayLead(l));
    if (whatsappFilter !== "ANY") {
      // Filter by *derived* preferred channel rather than raw whatsapp
      // presence so the filter result and the column cell can never
      // disagree (a B2B lead with a captured WA number still derives
      // to Email and so must be excluded from "WhatsApp reachable").
      out = out.filter((l) => {
        const channel = derivePreferredCommunication(l).channel;
        const isWa = channel === "whatsapp";
        return whatsappFilter === "HAS" ? isWa : !isWa;
      });
    }
    if (sourceFilter !== "ANY") {
      // Phase 2 attribution filter — match against the normalised value
      // so legacy / off-list rows funnel into "Other" the same way the
      // badge does, keeping the filter and the cell perfectly aligned.
      out = out.filter((l) => normalizeLeadSource(l.source) === sourceFilter);
    }
    if (routeFilter !== "ALL") {
      // Phase 5 — narrow by saved funnel context. The "stuck_application"
      // option matches the theme field; the rest match the route field.
      out = out.filter((l) => {
        const ctx = l.funnelContext;
        if (!ctx) return false;
        return routeFilter === "stuck_application"
          ? ctx.theme === "stuck_application"
          : ctx.route === routeFilter;
      });
    }
    if (timeRange !== "all") {
      const now = Date.now();
      const cutoff =
        timeRange === "today"
          ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
          : timeRange === "7d"
            ? now - 7 * 24 * 60 * 60 * 1000
            : now - 30 * 24 * 60 * 60 * 1000;
      out = out.filter((l) => {
        const created = new Date(l.createdAt).getTime();
        return !Number.isNaN(created) && created >= cutoff;
      });
    }
    if (scoreMin80) {
      const now = new Date();
      out = out.filter((l) => deriveLeadScore(l, now).score >= 80);
    }
    if (ownerFilter !== "all") {
      out = out.filter((l) =>
        ownerFilter === "assigned" ? !!l.assignedTo : !l.assignedTo,
      );
    }
    if (countryFilter !== "ANY") {
      out = out.filter(
        (l) => (l.countryOfResidence ?? l.nationality) === countryFilter,
      );
    }
    if (quickFilter === "hot") {
      const now = new Date();
      out = out.filter((l) => isHotLead(l, now));
    } else if (quickFilter === "overdue") {
      const now = new Date();
      out = out.filter((l) => isOverdueSla(l, now));
    } else if (quickFilter === "converted") {
      out = out.filter((l) => l.leadStatus === "converted");
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((l) =>
        [
          l.fullName,
          l.organizationName,
          l.representativeName,
          l.email,
          l.referenceNumber,
        ].some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    if (sort === "priority") {
      out = [...out].sort((a, b) => {
        const ra = priorityRank(a.leadPriority);
        const rb = priorityRank(b.leadPriority);
        if (ra !== rb) return ra - rb;
        // Tiebreak on createdAt DESC so high-priority newest is on top.
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
    } else if (sort === "score") {
      // Hottest-first: composite quality+urgency score from `deriveLeadScore`.
      // Tiebreak on createdAt DESC so among same-score leads the newer
      // capture surfaces first (matches the mental model of the
      // "Newest first" default).
      //
      // Performance + correctness: snapshot `now` once and pre-compute
      // each lead's score in a single pass, so the comparator runs
      // O(n log n) on numeric reads rather than re-deriving the score
      // per comparison. The shared `now` also avoids any boundary-time
      // jitter where a follow-up tipping from "due_soon" → "overdue"
      // mid-sort could break comparator transitivity.
      const now = new Date();
      const scored = out.map((lead) => ({
        lead,
        score: deriveLeadScore(lead, now).score,
      }));
      scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return (
          new Date(b.lead.createdAt).getTime() -
          new Date(a.lead.createdAt).getTime()
        );
      });
      out = scored.map((s) => s.lead);
    }
    // sort === "newest" is already the server's default order.
    return out;
  }, [
    leads,
    segment,
    quickFilter,
    search,
    whatsappFilter,
    sourceFilter,
    routeFilter,
    sort,
    timeRange,
    scoreMin80,
    ownerFilter,
    countryFilter,
  ]);

  const filtersAreActive =
    priority !== "ALL" ||
    status !== "ALL" ||
    whatsappFilter !== "ANY" ||
    sourceFilter !== "ANY" ||
    routeFilter !== "ALL" ||
    quickFilter !== "none" ||
    timeRange !== "all" ||
    scoreMin80 ||
    ownerFilter !== "all" ||
    countryFilter !== "ANY" ||
    search.trim().length > 0;

  // List vs Pipeline view toggle. Persisted in localStorage so an
  // operator who prefers the kanban doesn't have to re-toggle every
  // session. Defaults to "list" (the historical view) so first-time
  // users land somewhere familiar.
  const [view, setView] = useState<"list" | "pipeline">(() => {
    if (typeof window === "undefined") return "list";
    const saved = window.localStorage.getItem("ema:admin:view");
    return saved === "pipeline" ? "pipeline" : "list";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ema:admin:view", view);
    }
  }, [view]);
  // Per-row "Send update" dialog target. Null = dialog closed. The dialog is
  // rendered once at page level (see SendUpdateDialog) and switched between
  // leads via this state, so we don't pay for one Radix portal per row.
  const [sendUpdateTarget, setSendUpdateTarget] = useState<{
    id: string;
    referenceNumber: string;
    email: string | null;
    whatsapp: string | null;
  } | null>(null);

  // Phase 3 — single page-level timeline dialog driven by `timelineTarget`,
  // same rationale as `sendUpdateTarget`: avoids one Radix portal per row.
  const [timelineTarget, setTimelineTarget] = useState<{
    id: string;
    referenceNumber: string | null;
  } | null>(null);

  const adminLeadUrl = (id: string) =>
    `${(import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "")}/api/admin/leads/${id}`;

  // ---------------------------------------------------------------------
  // Inline CRM mutation (PATCH /api/admin/leads/:id)
  //
  // Concurrency-safe per-row optimistic update:
  //   * Snapshot ONLY the row being mutated (not the whole list) — so a
  //     concurrent successful edit on a different row is never clobbered
  //     when this request rolls back.
  //   * On error: restore that single row in place; other rows are left as
  //     whatever the cache currently holds.
  //   * On success: write the authoritative server payload back into the
  //     row (bumps updatedAt) and invalidate the list query — this guarantees
  //     reconciliation when the new status/priority moves the row out of the
  //     active filter.
  //   * On 401: clear the cached admin token so the next attempt re-prompts.
  // ---------------------------------------------------------------------
  // Returns the updated Lead on success (so callers like the Convert-to-Case
  // button can read the freshly-populated `caseId` from the response and
  // navigate immediately) or `null` on failure.  Existing callers using the
  // truthy-check pattern (`if (ok) …`) keep working unchanged because a
  // Lead object is truthy.
  const patchLead = async (
    id: string,
    patch: { status?: string; priority?: string; notes?: string | null },
  ): Promise<Lead | null> => {
    const token = getAdminToken();
    if (!token) return null;

    const original = qc
      .getQueryData<Lead[]>(listQueryKey)
      ?.find((l) => l.id === id);

    qc.setQueryData<Lead[]>(listQueryKey, (old) =>
      old?.map((l) =>
        l.id === id
          ? {
              ...l,
              ...(patch.status !== undefined ? { leadStatus: patch.status } : {}),
              ...(patch.priority !== undefined
                ? { leadPriority: patch.priority }
                : {}),
              ...(patch.notes !== undefined
                ? { adminNotes: patch.notes }
                : {}),
            }
          : l,
      ),
    );

    try {
      const res = await fetch(adminLeadUrl(id), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        if (res.status === 401) clearAdminToken();
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const updated = (await res.json()) as Lead;
      qc.setQueryData<Lead[]>(listQueryKey, (old) =>
        old?.map((l) => (l.id === id ? updated : l)),
      );
      // Refetch in the background so any filter-affecting changes (e.g. a
      // status change that moves the row out of the current filter) reconcile
      // without disturbing the just-applied optimistic UI.
      qc.invalidateQueries({ queryKey: listQueryKey });
      // Also refresh the segment-stats query so the headline cards
      // reflect inline status/priority changes without a page reload.
      qc.invalidateQueries({ queryKey: ["admin", "metricsLeads"] });
      return updated;
    } catch (err) {
      // Per-row rollback — only the row we tried to mutate is restored. Any
      // concurrent successful edit on another row keeps its updated value.
      if (original) {
        qc.setQueryData<Lead[]>(listQueryKey, (old) =>
          old?.map((l) => (l.id === id ? original : l)),
        );
      }
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    }
  };

  // Archive / restore a lead. Soft, reversible — no confirm dialog needed.
  // The row leaves the current view (active⇄archived) on success, so we drop
  // it optimistically then reconcile the list + headline cards.
  const setArchive = async (id: string, archive: boolean) => {
    const token = getAdminToken();
    if (!token) return;
    try {
      const res = await fetch(
        `${adminLeadUrl(id)}/${archive ? "archive" : "unarchive"}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-admin-token": token },
        },
      );
      if (!res.ok) {
        if (res.status === 401) clearAdminToken();
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      qc.setQueryData<Lead[]>(listQueryKey, (old) =>
        old?.filter((l) => l.id !== id),
      );
      qc.invalidateQueries({ queryKey: listQueryKey });
      qc.invalidateQueries({ queryKey: ["admin", "metricsLeads"] });
      toast({ title: archive ? "Lead archived" : "Lead restored" });
    } catch (err) {
      toast({
        title: archive ? "Archive failed" : "Restore failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Shared lead quick-action handlers. The leads-table rows keep their own
  // inline handlers (untouched); these mirror that exact behaviour so the
  // Lead Drawer can apply identical contact / convert flows without any new
  // backend calls.
  const handleContactLead = (lead: Lead) => {
    const contactMessage = buildContactMessage(
      lead.fullName,
      lead.referenceNumber,
    );
    const contact = contactHref(
      lead.email,
      typeof lead.whatsapp === "string" ? lead.whatsapp : null,
      contactMessage,
    );
    if (!contact) return;
    window.open(contact.href, "_blank", "noopener,noreferrer");
    trackEvent("lead_contact_clicked", {
      referenceNumber: lead.referenceNumber,
      payload: { leadId: lead.id, channel: contact.channel },
    });
    if (isStrictlyUpstreamOf(lead.leadStatus, "contacted")) {
      void patchLead(lead.id, { status: "contacted" }).then((ok) => {
        if (ok) toast({ title: "Marked as contacted" });
      });
    } else {
      toast({
        title: "Status unchanged",
        description:
          "Lead is already at or past “contacted” — no funnel regression applied.",
      });
    }
  };

  const handleConvertLead = (lead: Lead) => {
    void patchLead(lead.id, { status: "converted" }).then((updated) => {
      if (!updated) return;
      if (updated.caseId) {
        toast({ title: "Case created" });
        setLocation(`/admin/case/${updated.caseId}`);
      } else {
        toast({
          title: "Converted",
          description: "Lead marked converted but no case id was returned.",
          variant: "destructive",
        });
      }
    });
  };

  // Permanently delete a lead. Destructive + irreversible — gated behind the
  // page-level AlertDialog (deleteTarget). The server refuses (409) if the
  // lead has been converted to a case; that message surfaces in the toast.
  const deleteLead = async (id: string) => {
    const token = getAdminToken();
    if (!token) return;
    setDeleting(true);
    try {
      const res = await fetch(adminLeadUrl(id), {
        method: "DELETE",
        credentials: "include",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        if (res.status === 401) clearAdminToken();
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      qc.setQueryData<Lead[]>(listQueryKey, (old) =>
        old?.filter((l) => l.id !== id),
      );
      qc.invalidateQueries({ queryKey: listQueryKey });
      qc.invalidateQueries({ queryKey: ["admin", "metricsLeads"] });
      toast({ title: "Lead deleted" });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  // Chrome v3: bulk CSV export moved to /admin/exports (Admin dropdown
  // → Operations → Exports). The previous topbar/inline button and its
  // handler were retired here; the per-row CSV-related UI on the leads
  // table is unaffected.

  // Dashboard metrics derived from the filter-free `metricsLeads` dataset.
  // KPIs respect the active segment; segment counts + the critical-overstay
  // banner are computed across the full population so they never change as the
  // operator narrows the table.
  const metricsForSegment = useMemo(() => {
    const base = metricsLeads ?? [];
    return segment === "all"
      ? base
      : base.filter((l) => segmentOfLead(l) === segment);
  }, [metricsLeads, segment]);
  const kpis = useMemo(
    () => computeKpis(metricsForSegment),
    [metricsForSegment],
  );
  const segmentCounts = useMemo(
    () => computeSegmentCounts(metricsLeads ?? []),
    [metricsLeads],
  );
  const criticalOverstay = useMemo(
    () => criticalOverstayLeads(metricsLeads ?? []),
    [metricsLeads],
  );

  // Chip option lists derived from the full population so the dropdowns stay
  // stable as the operator narrows the table.
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of metricsLeads ?? []) {
      const c = l.countryOfResidence ?? l.nationality;
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [metricsLeads]);
  const sourceOptions = useMemo(
    () => LEAD_SOURCES.map((s) => ({ value: s, label: leadSourceMeta(s).label })),
    [],
  );

  return (
    <AdminLayout title="Dashboard">
      <div className="flex gap-6 pt-4">
        <DashboardSidebar
          segment={segment}
          onSegment={setSegment}
          quickFilter={quickFilter}
          onQuickFilter={setQuickFilter}
          counts={segmentCounts}
          kpis={kpis}
        />
        <div className="min-w-0 flex-1 space-y-6">
          <CommandSearchBar value={search} onChange={setSearch} />

          <CriticalAlertBanner
            leads={criticalOverstay}
            onAction={(lead) => {
              setSegment("overstay");
              setDrawerLead(lead);
            }}
          />

          <SegmentToggle
            segment={segment}
            onChange={setSegment}
            counts={segmentCounts}
          />

          <KpiStrip
            kpis={kpis}
            activeQuick={quickFilter}
            onQuick={setQuickFilter}
          />

        <Card>
          <CardHeader>
            <CardTitle>Filters & Sort</CardTitle>
            <CardDescription>
              Narrow the lead list by status, priority or preferred channel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <SavedViewsBar
                currentFilters={{
                  // SavedViews persist a 3-way segment; map the v2 4-way down
                  // (overstay collapses into individual for saved presets).
                  segment:
                    segment === "business"
                      ? "professional"
                      : segment === "all"
                        ? "ALL"
                        : "individual",
                  status,
                  priority,
                  whatsapp: whatsappFilter as "ANY" | "HAS" | "NONE",
                  source: sourceFilter,
                  sort,
                }}
                onApply={(f) => {
                  setSegment(
                    f.segment === "professional"
                      ? "business"
                      : f.segment === "individual"
                        ? "individual"
                        : "all",
                  );
                  setStatus(f.status);
                  setPriority(f.priority);
                  setWhatsappFilter(f.whatsapp);
                  // Tolerate legacy presets persisted before Phase 2.
                  setSourceFilter(f.source ?? "ANY");
                  setSort(f.sort);
                }}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Status
                </label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger data-testid="select-filter-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Preferred channel
                </label>
                <Select
                  value={whatsappFilter}
                  onValueChange={setWhatsappFilter}
                >
                  <SelectTrigger data-testid="select-filter-whatsapp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WHATSAPP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Source
                </label>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger data-testid="select-filter-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Source: Any</SelectItem>
                    {LEAD_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {leadSourceMeta(s).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Route
                </label>
                <Select
                  value={routeFilter}
                  onValueChange={(v) =>
                    setRouteFilter(v as typeof routeFilter)
                  }
                >
                  <SelectTrigger data-testid="select-filter-route">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All routes</SelectItem>
                    <SelectItem value="traveller">Traveller</SelectItem>
                    <SelectItem value="overstay_undesirable">
                      Overstayed / Undesirable
                    </SelectItem>
                    <SelectItem value="firm_professional">
                      Firm / Professional
                    </SelectItem>
                    <SelectItem value="stuck_application">
                      Stuck Application / Visa Anomaly
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Sort
                </label>
                <Select
                  value={sort}
                  onValueChange={(v) =>
                    setSort(v as "newest" | "priority" | "score")
                  }
                >
                  <SelectTrigger data-testid="select-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <FilterChips
          timeRange={timeRange}
          onTimeRange={setTimeRange}
          scoreMin80={scoreMin80}
          onScoreMin80={setScoreMin80}
          owner={ownerFilter}
          onOwner={setOwnerFilter}
          source={sourceFilter}
          onSource={setSourceFilter}
          sourceOptions={sourceOptions}
          country={countryFilter}
          onCountry={setCountryFilter}
          countryOptions={countryOptions}
        />

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>
                  {segment === "business"
                    ? "Business Leads"
                    : segment === "overstay"
                      ? "Overstay Leads"
                      : segment === "individual"
                        ? "Individual Leads"
                        : "Leads"}
                </CardTitle>
                <CardDescription>
                  {segment === "business"
                    ? "Firms, consultancies, and partners — created via CSV/XLSX import or manual entry. Self-assessment submissions never land here."
                    : segment === "overstay"
                      ? "Individuals whose situation rolls up to overstay risk — time-sensitive, prioritise contact."
                      : segment === "individual"
                        ? "Public assessment submissions only — captured automatically when someone completes the 7/8-step assessment flow."
                        : view === "list"
                          ? "Inline editor — change status or priority directly in the table. Updates apply optimistically and persist via an admin-only endpoint."
                          : "Drag a card between columns to advance it through the funnel. Forward-only — backwards moves are blocked client-side and again server-side (HTTP 409)."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href="/admin/import"
                  className="inline-flex items-center rounded-md border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                  data-testid="leads-import-button"
                >
                  + Import
                </Link>
              <div
                className="inline-flex rounded-md border bg-background p-0.5"
                role="tablist"
                aria-label="Lead view mode"
                data-testid="leads-view-toggle"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "list"}
                  onClick={() => setView("list")}
                  data-testid="leads-view-list"
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    view === "list"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "pipeline"}
                  onClick={() => setView("pipeline")}
                  data-testid="leads-view-pipeline"
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    view === "pipeline"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Pipeline
                </button>
              </div>
              <div
                className="inline-flex rounded-md border bg-background p-0.5"
                role="tablist"
                aria-label="Lead archive view"
                data-testid="leads-archive-toggle"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!archivedView}
                  onClick={() => setArchivedView(false)}
                  data-testid="leads-view-active"
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    !archivedView
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Active
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={archivedView}
                  onClick={() => setArchivedView(true)}
                  data-testid="leads-view-archived"
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    archivedView
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Archived
                </button>
              </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : isError ? (
              <div className="text-center py-12 text-destructive border rounded-lg border-dashed space-y-2">
                <div>{error?.message ?? "Failed to load leads."}</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refetch()}
                  data-testid="button-retry-leads"
                >
                  Retry
                </Button>
              </div>
            ) : !visibleLeads || visibleLeads.length === 0 ? (
              <div
                className="text-center py-12 text-muted-foreground border rounded-lg border-dashed"
                data-testid="empty-state-leads"
              >
                {filtersAreActive
                  ? "No leads match the current filters."
                  : "No leads yet"}
              </div>
            ) : view === "pipeline" ? (
              <LeadPipelineBoard
                leads={visibleLeads}
                onMove={async (id, target) => {
                  const updated = await patchLead(id, { status: target });
                  return updated !== null;
                }}
              />
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <HelpTooltip
                          label="Lead"
                          description="The lead's full name (individual) or organisation name (B2B), with reference number."
                        />
                      </TableHead>
                      <TableHead>
                        <HelpTooltip
                          label="Segment & Scenario"
                          description="Which operator segment the lead rolls up to (Individual, Overstay or Business) and its immigration / service scenario."
                        />
                      </TableHead>
                      <TableHead>
                        <HelpTooltip
                          label="Score & Tier"
                          description="Composite lead score (0–100) with letter grade, plus the intended commercial tier when captured."
                        />
                      </TableHead>
                      <TableHead>
                        <HelpTooltip
                          label="SLA"
                          description="Follow-up status: overdue (amber), due today (blue), on track (green) or not set."
                        />
                      </TableHead>
                      <TableHead>
                        <HelpTooltip
                          label="Owner"
                          description="The admin the lead is assigned to. Unassigned leads have no owner yet."
                        />
                      </TableHead>
                      <TableHead>
                        <HelpTooltip
                          label="Age"
                          description="How long since the lead first entered the system, with the captured date."
                        />
                      </TableHead>
                      <TableHead>
                        <HelpTooltip
                          label="Source"
                          description="Where the lead originated (assessment, import, manual entry, campaign…)."
                        />
                      </TableHead>
                      <TableHead className="text-right">
                        <HelpTooltip
                          label="Actions"
                          description="Status & priority editors plus quick actions: Contact, View, Send Update, Timeline, Archive and Delete."
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleLeads.map((lead) => {
                      const hasWhatsapp =
                        (lead as { hasWhatsapp?: boolean }).hasWhatsapp ??
                        (typeof lead.whatsapp === "string" &&
                          lead.whatsapp.length > 0);
                      const contactMessage = buildContactMessage(
                        lead.fullName,
                        lead.referenceNumber,
                      );
                      const contact = contactHref(
                        lead.email,
                        typeof lead.whatsapp === "string" ? lead.whatsapp : null,
                        contactMessage,
                      );
                      return (
                        <TableRow
                          key={lead.id}
                          data-testid={`row-lead-${lead.referenceNumber}`}
                          data-has-whatsapp={hasWhatsapp ? "true" : "false"}
                          data-status={lead.leadStatus}
                          className={`even:bg-muted/10 hover:bg-muted/20 transition-colors [&>td]:py-3 ${rowHighlightClass(lead.leadStatus)}`}
                        >
                          <TableCell>
                            <div className="font-medium flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setDrawerLead(lead)}
                                className="text-left hover:text-[#2764F0] hover:underline"
                                data-testid={`button-open-drawer-${lead.referenceNumber}`}
                              >
                                {lead.fullName ??
                                  lead.organizationName ??
                                  lead.representativeName ??
                                  lead.email ??
                                  lead.referenceNumber}
                              </button>
                              {lead.leadType === "professional" && (
                                <span
                                  className="inline-flex items-center rounded border border-blue-300 bg-blue-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-blue-700"
                                  data-testid={`badge-b2b-${lead.referenceNumber}`}
                                >
                                  B2B
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {lead.referenceNumber}
                            </div>
                            {lead.funnelContext &&
                            (lead.funnelContext.route ||
                              lead.funnelContext.theme) ? (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {lead.funnelContext.route ? (
                                  <span
                                    className="inline-flex items-center rounded border border-cyan-300 bg-cyan-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-cyan-800"
                                    data-testid={`badge-funnel-route-${lead.referenceNumber}`}
                                    title="Funnel route (where this lead came from)"
                                  >
                                    {funnelRouteLabel(lead.funnelContext.route)}
                                  </span>
                                ) : null}
                                {lead.funnelContext.theme ? (
                                  <span
                                    className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-amber-800"
                                    data-testid={`badge-funnel-theme-${lead.referenceNumber}`}
                                    title="Funnel theme"
                                  >
                                    {funnelThemeLabel(lead.funnelContext.theme)}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1 items-start">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${segmentPillClass(
                                  segmentOfLead(lead),
                                )}`}
                                data-testid={`segment-${lead.referenceNumber}`}
                              >
                                {segmentLabel(segmentOfLead(lead))}
                              </span>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {enquiryCategoryLabel(lead)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 flex-wrap">
                              <LeadScoreBadge
                                lead={lead}
                                testIdSuffix={lead.referenceNumber ?? lead.id}
                              />
                              {lead.intendedTier ? (
                                <span
                                  className={`inline-flex items-center rounded border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide ${tierBadgeClass(lead.intendedTier)}`}
                                  data-testid={`badge-tier-${lead.referenceNumber}`}
                                  title="Intended commercial tier"
                                >
                                  {tierLabel(lead.intendedTier)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  No tier
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <SlaPill lead={lead} />
                          </TableCell>
                          <TableCell>
                            <span
                              className="text-xs"
                              data-testid={`owner-${lead.referenceNumber}`}
                            >
                              {lead.assignedTo ? (
                                "Assigned"
                              ) : (
                                <span className="text-muted-foreground">
                                  Unassigned
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                            <div className="flex flex-col gap-1 items-start">
                              <span data-testid={`age-${lead.referenceNumber}`}>
                                {formatDistanceToNowStrict(
                                  new Date(lead.createdAt),
                                  { addSuffix: true },
                                )}
                              </span>
                              <span className="text-[10px]">
                                {format(new Date(lead.createdAt), "MMM d, yyyy")}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <LeadSourceBadge
                              source={lead.source}
                              campaign={lead.sourceCampaign}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex items-center gap-2">
                                <Select
                                  value={lead.leadStatus}
                                  onValueChange={(v) =>
                                    patchLead(lead.id, { status: v })
                                  }
                                >
                                  <SelectTrigger
                                    className="h-8 w-[9.5rem] text-xs"
                                    data-testid={`select-status-${lead.referenceNumber}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {STATUS_VALUES.map((s) => {
                                      // Funnel-regression guard: disable any
                                      // option that would move this lead
                                      // BACKWARD.  The current status itself
                                      // stays enabled so the dropdown can
                                      // render its selected value normally.
                                      const allowed = canAdvanceStatus(
                                        lead.leadStatus,
                                        s,
                                      );
                                      return (
                                        <SelectItem
                                          key={s}
                                          value={s}
                                          disabled={!allowed}
                                          title={
                                            allowed
                                              ? undefined
                                              : "Forward-only funnel — cannot regress"
                                          }
                                          data-testid={`status-option-${lead.referenceNumber}-${s}`}
                                        >
                                          {statusLabel(s)}
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={lead.leadPriority ?? "medium"}
                                  onValueChange={(v) =>
                                    patchLead(lead.id, { priority: v })
                                  }
                                >
                                  <SelectTrigger
                                    className={`h-8 w-[7rem] text-xs ${priorityBadgeClass(lead.leadPriority)}`}
                                    data-testid={`select-priority-${lead.referenceNumber}`}
                                  >
                                    <SelectValue>
                                      {priorityLabel(lead.leadPriority)}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PRIORITY_VALUES.map((p) => (
                                      <SelectItem
                                        key={p}
                                        value={p}
                                        className="capitalize"
                                      >
                                        {p}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center justify-end gap-1 flex-wrap">
                              {contact ? (
                                <Button
                                  variant="default"
                                  size="sm"
                                  data-testid={`button-contact-${lead.referenceNumber}`}
                                  data-channel={contact.channel}
                                  title={
                                    contact.channel === "whatsapp"
                                      ? "Open WhatsApp chat (pre-filled) and mark contacted"
                                      : "Open email draft (pre-filled) and mark contacted"
                                  }
                                  onClick={() => {
                                    // ORDER MATTERS:
                                    // 1) Open the contact link FIRST in the
                                    //    same synchronous tick as the user's
                                    //    click.  Browsers will block popups
                                    //    that open after an `await`.  Both
                                    //    channels use window.open so the
                                    //    admin tab is never navigated away
                                    //    — guarantees the subsequent PATCH
                                    //    and analytics fetches are not
                                    //    interrupted by a top-level
                                    //    location change (mailto handlers
                                    //    can otherwise abort in-flight work
                                    //    on some browsers).
                                    window.open(
                                      contact.href,
                                      "_blank",
                                      "noopener,noreferrer",
                                    );

                                    // 2) Fire-and-forget analytics — never
                                    //    blocks the UI on network failure.
                                    trackEvent("lead_contact_clicked", {
                                      referenceNumber: lead.referenceNumber,
                                      payload: {
                                        leadId: lead.id,
                                        channel: contact.channel,
                                      },
                                    });

                                    // 3) Auto-advance status only when the
                                    //    lead is STRICTLY upstream of
                                    //    "contacted".  Same-or-later leads
                                    //    skip the PATCH so the funnel
                                    //    cannot regress (the server would
                                    //    reject regressions with 409
                                    //    anyway, but skipping client-side
                                    //    avoids the failed-request noise
                                    //    in the toast/log streams).
                                    //    A short toast keeps the UX honest
                                    //    about the skip so operators aren't
                                    //    confused by silence.
                                    if (
                                      isStrictlyUpstreamOf(
                                        lead.leadStatus,
                                        "contacted",
                                      )
                                    ) {
                                      void patchLead(lead.id, {
                                        status: "contacted",
                                      }).then((ok) => {
                                        if (ok) {
                                          toast({
                                            title: "Marked as contacted",
                                          });
                                        }
                                      });
                                    } else {
                                      toast({
                                        title: "Status unchanged",
                                        description:
                                          "Lead is already at or past “contacted” — no funnel regression applied.",
                                      });
                                    }
                                  }}
                                >
                                  Contact
                                </Button>
                              ) : (
                                <Button
                                  variant="default"
                                  size="sm"
                                  disabled
                                  title="No email or WhatsApp on file"
                                  data-testid={`button-contact-${lead.referenceNumber}`}
                                >
                                  Contact
                                </Button>
                              )}
                              {lead.leadStatus === "ready_for_case" && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  title="Convert this lead into a case and open the case detail view"
                                  data-testid={`button-convert-case-${lead.referenceNumber}`}
                                  onClick={() => {
                                    void patchLead(lead.id, {
                                      status: "converted",
                                    }).then((updated) => {
                                      if (!updated) return;
                                      if (updated.caseId) {
                                        toast({
                                          title: "Case created",
                                        });
                                        setLocation(
                                          `/admin/case/${updated.caseId}`,
                                        );
                                      } else {
                                        toast({
                                          title: "Converted",
                                          description:
                                            "Lead marked converted but no case id was returned.",
                                          variant: "destructive",
                                        });
                                      }
                                    });
                                  }}
                                >
                                  Convert to Case
                                </Button>
                              )}
                              {lead.leadStatus === "converted" &&
                                lead.caseId && (
                                  <Link href={`/admin/case/${lead.caseId}`}>
                                    <Button
                                      variant="default"
                                      size="sm"
                                      data-testid={`button-open-case-${lead.referenceNumber}`}
                                      title="Open the linked case"
                                    >
                                      Open Case
                                    </Button>
                                  </Link>
                                )}
                              <Button
                                variant="ghost"
                                size="sm"
                                data-testid={`link-lead-${lead.referenceNumber}`}
                                title="Open the lead drawer for a quick view"
                                onClick={() => setDrawerLead(lead)}
                              >
                                View
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!lead.email && !hasWhatsapp}
                                title={
                                  lead.email || hasWhatsapp
                                    ? "Send a one-off update to this lead"
                                    : "No email or WhatsApp on file"
                                }
                                onClick={() =>
                                  setSendUpdateTarget({
                                    id: lead.id,
                                    referenceNumber: lead.referenceNumber,
                                    email: lead.email ?? null,
                                    whatsapp:
                                      typeof lead.whatsapp === "string" &&
                                      lead.whatsapp.length > 0
                                        ? lead.whatsapp
                                        : null,
                                  })
                                }
                                data-testid={`button-send-update-${lead.referenceNumber}`}
                              >
                                Send update
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="View full activity timeline"
                                onClick={() =>
                                  setTimelineTarget({
                                    id: lead.id,
                                    referenceNumber:
                                      lead.referenceNumber ?? null,
                                  })
                                }
                                data-testid={`button-timeline-${lead.referenceNumber}`}
                              >
                                Timeline
                              </Button>
                              {archivedView ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Restore this lead to the active funnel"
                                  onClick={() => void setArchive(lead.id, false)}
                                  data-testid={`button-restore-${lead.referenceNumber}`}
                                >
                                  Restore
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Archive this lead — hidden from the funnel but recoverable"
                                  onClick={() => void setArchive(lead.id, true)}
                                  data-testid={`button-archive-${lead.referenceNumber}`}
                                >
                                  Archive
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                title="Permanently delete this lead"
                                onClick={() =>
                                  setDeleteTarget({
                                    id: lead.id,
                                    referenceNumber: lead.referenceNumber ?? null,
                                  })
                                }
                                data-testid={`button-delete-${lead.referenceNumber}`}
                              >
                                Delete
                              </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>

      <LeadDrawer
        lead={
          drawerLead
            ? (leads?.find((l) => l.id === drawerLead.id) ?? drawerLead)
            : null
        }
        onClose={() => setDrawerLead(null)}
        archivedView={archivedView}
        onPatch={(id, patch) => patchLead(id, patch)}
        onContact={handleContactLead}
        onConvert={handleConvertLead}
        onSendUpdate={(lead) =>
          setSendUpdateTarget({
            id: lead.id,
            referenceNumber: lead.referenceNumber,
            email: lead.email ?? null,
            whatsapp:
              typeof lead.whatsapp === "string" && lead.whatsapp.length > 0
                ? lead.whatsapp
                : null,
          })
        }
        onArchive={(lead, archive) => {
          void setArchive(lead.id, archive);
          setDrawerLead(null);
        }}
        onDelete={(lead) =>
          setDeleteTarget({
            id: lead.id,
            referenceNumber: lead.referenceNumber ?? null,
          })
        }
      />

      <SendUpdateDialog
        target={sendUpdateTarget}
        onClose={() => setSendUpdateTarget(null)}
        onUnauthorized={clearAdminToken}
      />

      <LeadTimelineDialog
        open={timelineTarget !== null}
        onOpenChange={(o) => {
          if (!o) setTimelineTarget(null);
        }}
        leadId={timelineTarget?.id ?? null}
        referenceNumber={timelineTarget?.referenceNumber ?? null}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-lead">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.referenceNumber
                ? `Lead ${deleteTarget.referenceNumber} and its documents, messages and activity will be permanently removed. This cannot be undone — choose Archive instead if you may need it later.`
                : "This lead and its documents, messages and activity will be permanently removed. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              data-testid="button-delete-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void deleteLead(deleteTarget.id);
              }}
              data-testid="button-delete-confirm"
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

/**
 * Per-row "Send update" modal.
 *
 * Posts to the token-gated `/api/admin/leads/:id/send-update` endpoint. The
 * server creates the engagement row BEFORE attempting to send, so even a
 * provider failure leaves an auditable history entry — the dialog therefore
 * always surfaces the resulting status (sent / pending / failed) rather than
 * just a generic success.
 *
 * The dialog is rendered once at the page level and driven by the parent's
 * `target` prop; this avoids one Dialog instance per table row (which would
 * be hundreds of detached Radix portals on a busy admin page).
 */
function SendUpdateDialog({
  target,
  onClose,
  onUnauthorized,
}: {
  target: {
    id: string;
    referenceNumber: string;
    email: string | null;
    whatsapp: string | null;
  } | null;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  // Reset the textarea + default channel every time a new target opens so
  // we don't leak the previous lead's draft message or channel choice.
  // Default channel = whichever the lead has on file (preferring email if
  // both are available, since email is the long-established default).
  useEffect(() => {
    if (target) {
      setMessage("");
      setChannel(target.email ? "email" : target.whatsapp ? "whatsapp" : "email");
    }
  }, [target?.id]);

  const open = target !== null;
  const trimmed = message.trim();
  const recipientAvailable =
    !!target &&
    ((channel === "email" && !!target.email) ||
      (channel === "whatsapp" && !!target.whatsapp));
  const canSend = open && trimmed.length > 0 && recipientAvailable && !sending;

  const handleSend = async () => {
    if (!target || !canSend) return;
    const token = getAdminToken();
    if (!token) return;
    setSending(true);
    try {
      const res = await fetch(
        `${(import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "")}/api/admin/leads/${target.id}/send-update`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({ message: trimmed, channel }),
        },
      );
      if (res.status === 401) {
        onUnauthorized();
        throw new Error("Admin token rejected");
      }
      const body = (await res.json().catch(() => ({}))) as {
        sent?: boolean;
        reason?: string | null;
        error?: string;
        engagement?: { status?: string };
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const channelLabel = channel === "whatsapp" ? "WhatsApp" : "Email";
      if (body.sent) {
        toast({
          title: "Update sent",
          description: `${channelLabel} delivered to lead ${target.referenceNumber}.`,
        });
      } else if (body.engagement?.status === "pending") {
        toast({
          title: "Update queued",
          description: `${channelLabel} provider is temporarily unavailable; the engagement is recorded as pending and can be retried.`,
        });
      } else {
        // Permanent failure — surface the specific reason. The most common
        // operator-actionable cases for whatsapp get explicit guidance;
        // everything else falls through to the raw server reason.
        const description =
          body.reason === "not_configured"
            ? "WhatsApp is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM secrets, then re-send."
            : body.reason === "invalid_credentials"
              ? "Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (they may be wrong or rotated) and re-send."
              : body.reason === "recipient_not_joined_sandbox"
                ? "The lead has not joined the Twilio WhatsApp Sandbox. Ask them to send 'join <your-sandbox-keyword>' to the sandbox number, then re-send."
                : body.reason === "outside_session_window"
                  ? "More than 24 hours have passed since the lead's last reply. WhatsApp requires a pre-approved Content Template to message outside this window."
                  : body.reason === "recipient_unsubscribed"
                    ? "The lead has replied STOP and is unsubscribed from WhatsApp. They must re-opt-in before you can send again."
                    : body.reason === "invalid_recipient"
                      ? "The lead's WhatsApp number is not a valid E.164 phone number."
                      : (body.reason ?? "Engagement saved but the send failed.");
        toast({
          title: "Send failed",
          description,
          variant: "destructive",
        });
      }
      onClose();
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !sending) onClose();
      }}
    >
      <DialogContent data-testid="dialog-send-update">
        <DialogHeader>
          <DialogTitle>Send update</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Sending to lead <strong>{target.referenceNumber}</strong> via{" "}
                {channel === "whatsapp" ? "WhatsApp" : "email"}.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Channel
            </label>
            <Select
              value={channel}
              onValueChange={(v) => setChannel(v as "email" | "whatsapp")}
              disabled={sending}
            >
              <SelectTrigger
                className="h-9 text-sm"
                data-testid="select-send-update-channel"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email" disabled={!target?.email}>
                  Email{target?.email ? "" : " (no address on file)"}
                </SelectItem>
                <SelectItem value="whatsapp" disabled={!target?.whatsapp}>
                  WhatsApp{target?.whatsapp ? "" : " (no number on file)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type the update message you want to send to this lead…"
            rows={6}
            disabled={sending}
            data-testid="textarea-send-update-message"
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={sending}
            data-testid="button-cancel-send-update"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!canSend}
            data-testid="button-confirm-send-update"
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
