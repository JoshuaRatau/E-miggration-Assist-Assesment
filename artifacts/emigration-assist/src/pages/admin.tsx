import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetStatsSummary,
  type Lead,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";
import { trackEvent } from "@/lib/analytics";
import {
  canAdvanceStatus,
  isStrictlyUpstreamOf,
  statusLabel,
} from "@/lib/leadStatus";
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
import { BrandHeader } from "@/components/brand-header";
import { AdminUserMenu } from "@/components/admin-user-menu";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { LeadMixCharts } from "@/components/lead-mix-charts";
import { LeadPipelineBoard } from "@/components/lead-pipeline-board";
import { Button } from "@/components/ui/button";
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
// and converted; CRM Phase A added awaiting_response, engaged, proposal_sent
// in funnel-monotonic positions and `critical` above `high`. The funnel is
// forward-only (server returns 409 on regression).
const STATUS_VALUES = [
  "new",
  "reviewing",
  "contacted",
  "awaiting_response",
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
  { value: "awaiting_response", label: "Awaiting response" },
  { value: "engaged", label: "Engaged" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal_sent", label: "Proposal sent" },
  { value: "ready_for_case", label: "Ready for case" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

const WHATSAPP_OPTIONS = [
  { value: "ANY", label: "WhatsApp: Any" },
  { value: "HAS", label: "WhatsApp: Has" },
  { value: "NONE", label: "WhatsApp: None" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "priority", label: "Priority first (high → low)" },
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

function whatsappCell(hasWhatsapp: boolean) {
  if (hasWhatsapp) {
    return (
      <span
        className="text-green-600 text-lg font-semibold"
        aria-label="Has WhatsApp"
        title="Has WhatsApp"
      >
        ✔
      </span>
    );
  }
  return (
    <span
      className="text-muted-foreground text-lg"
      aria-label="No WhatsApp"
      title="No WhatsApp"
    >
      ✖
    </span>
  );
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

// Next-step hint per status.  Server also derives this in `deriveNextStep`
// (see classification.ts) — the client recomputes locally so the column
// updates instantly on inline status edits without waiting for a refetch.
const NEXT_STEP_BY_STATUS: Record<string, string> = {
  new: "Review lead",
  reviewing: "Contact lead",
  contacted: "Await response",
  awaiting_response: "Follow up",
  engaged: "Qualify lead",
  qualified: "Send proposal",
  proposal_sent: "Prepare case conversion",
  ready_for_case: "Initiate case handover",
  converted: "Move to case system",
};

function nextStepFor(status: string | null | undefined): string | null {
  if (!status) return null;
  return NEXT_STEP_BY_STATUS[status] ?? null;
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

// "Visa Type" surfaces the lead's `immigrationSituation` (the canonical
// enum captured in the funnel: valid / expired / overstay / undesirable /
// prohibited / unknown).  Free-form `visaHistory` is operator-only and
// stays in the detail page.
function visaTypeLabel(situation: string | null | undefined): string {
  if (!situation) return "—";
  return situation.replace(/_/g, " ");
}

export function Admin() {
  useEffect(() => {
    document.title = "Admin Overview | E-Migration Assist";
  }, []);

  const [priority, setPriority] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [whatsappFilter, setWhatsappFilter] = useState("ANY");
  const [sort, setSort] = useState<"newest" | "priority">("newest");

  // Server-side filters that we forward to GET /api/leads.  WhatsApp is
  // applied client-side because the server contract has no filter for it
  // (`hasWhatsapp` is derived from the `whatsapp` field at serialization).
  const serverParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: 200 };
    if (priority !== "ALL") p.priority = priority;
    if (status !== "ALL") p.status = status;
    return p;
  }, [priority, status]);

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
        `${import.meta.env.BASE_URL}api/leads`,
        window.location.origin,
      );
      for (const [k, v] of Object.entries(serverParams)) {
        url.searchParams.set(k, String(v));
      }
      const res = await fetch(url.toString(), {
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

  // Apply the WhatsApp filter and the optional priority sort on the client.
  // `hasWhatsapp` lives on the serialized payload; we fall back to checking
  // the raw `whatsapp` field for resilience against older payloads.
  const visibleLeads = useMemo(() => {
    if (!leads) return leads;
    let out = leads;
    if (whatsappFilter !== "ANY") {
      out = out.filter((l) => {
        const has =
          (l as { hasWhatsapp?: boolean }).hasWhatsapp ??
          (typeof l.whatsapp === "string" && l.whatsapp.length > 0);
        return whatsappFilter === "HAS" ? has : !has;
      });
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
    }
    // sort === "newest" is already the server's default order.
    return out;
  }, [leads, whatsappFilter, sort]);

  const filtersAreActive =
    priority !== "ALL" || status !== "ALL" || whatsappFilter !== "ANY";

  const { data: stats } = useGetStatsSummary();
  const [sendingUpdate, setSendingUpdate] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
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

  const sendUpdateUrl = `${import.meta.env.BASE_URL}api/admin/email/update`;
  const adminLeadUrl = (id: string) =>
    `${import.meta.env.BASE_URL}api/admin/leads/${id}`;

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
    patch: { status?: string; priority?: string },
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
            }
          : l,
      ),
    );

    try {
      const res = await fetch(adminLeadUrl(id), {
        method: "PATCH",
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

  // CSV export goes through fetch + blob download so we can send the admin
  // token in a header rather than putting it in the URL (URLs get logged).
  const handleExportCsv = async () => {
    if (exportingCsv) return;
    const token = getAdminToken();
    if (!token) return;
    setExportingCsv(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/leads/export.csv`,
        { headers: { "x-admin-token": token } },
      );
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ema-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExportingCsv(false);
    }
  };

  const handleSendUpdateEmail = async () => {
    if (sendingUpdate) return;

    const token = getAdminToken();
    if (!token) return;

    const ok = window.confirm(
      "Send the silent update email to every lead with consent and an email on file?",
    );
    if (!ok) return;

    setSendingUpdate(true);
    try {
      const res = await fetch(sendUpdateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminToken();
          toast({
            title: "Invalid admin token",
            description: "Please try again with the correct token.",
            variant: "destructive",
          });
        } else if (res.status === 503) {
          toast({
            title: "Not configured",
            description:
              "ADMIN_EMAIL_TOKEN is not set on the server. Set it in environment secrets.",
            variant: "destructive",
          });
        } else if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as {
            retryAfterSeconds?: number;
          };
          toast({
            title: "Rate limited",
            description: `Please wait ${body.retryAfterSeconds ?? 300} seconds before sending again.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Failed",
            description: `Server returned ${res.status}.`,
            variant: "destructive",
          });
        }
        return;
      }
      const body = (await res.json()) as {
        eligibleRecipients: number;
        attempted: number;
        succeeded: number;
        failed: number;
      };
      toast({
        title: "Update email sent",
        description: `Eligible: ${body.eligibleRecipients} • Sent: ${body.succeeded} • Failed: ${body.failed}`,
      });
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSendingUpdate(false);
    }
  };

  // Status counts for the top summary cards.  The /stats/summary endpoint
  // returns lowercase canonical statuses in `byStatus`, so we look those up
  // directly — no priority counts are surfaced as cards in V1 of the
  // conversion engine (priority is still visible per row via the badge).
  const statusCount = (key: string) =>
    stats?.byStatus?.find((c) => c.category === key)?.count ?? 0;

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <BrandHeader
          variant="compact"
          leftSlot={<DashboardGreeting />}
          rightSlot={
            <div className="flex flex-col-reverse sm:flex-col gap-3 items-stretch sm:items-end">
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSendUpdateEmail}
                  disabled={sendingUpdate}
                  data-testid="button-send-update-email"
                >
                  {sendingUpdate ? "Sending..." : "Send Update Email"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={exportingCsv}
                  data-testid="button-export-leads"
                >
                  {exportingCsv ? "Exporting…" : "Export Leads (CSV)"}
                </Button>
                <Link href="/admin/import?type=professional">
                  <Button
                    size="sm"
                    data-testid="button-import-professionals"
                  >
                    Import Professionals
                  </Button>
                </Link>
              </div>
              <div className="flex justify-end">
                <AdminUserMenu />
              </div>
            </div>
          }
        />

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Leads</CardDescription>
              <CardTitle className="text-3xl" data-testid="stat-total-leads">
                {stats?.totalAssessments ?? 0}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>New Leads</CardDescription>
              <CardTitle
                className="text-3xl text-blue-600"
                data-testid="stat-status-new"
              >
                {statusCount("new")}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Contacted</CardDescription>
              <CardTitle
                className="text-3xl text-amber-600"
                data-testid="stat-status-contacted"
              >
                {statusCount("contacted")}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Qualified</CardDescription>
              <CardTitle
                className="text-3xl text-green-600"
                data-testid="stat-status-qualified"
              >
                {statusCount("qualified")}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <LeadMixCharts />

        <Card>
          <CardHeader>
            <CardTitle>Filters & Sort</CardTitle>
            <CardDescription>
              Narrow the lead list by status, priority or WhatsApp availability.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
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
                  WhatsApp
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
                  Sort
                </label>
                <Select
                  value={sort}
                  onValueChange={(v) => setSort(v as "newest" | "priority")}
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

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Leads</CardTitle>
                <CardDescription>
                  {view === "list"
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
                      <TableHead>Name</TableHead>
                      <TableHead>Visa Type</TableHead>
                      <TableHead className="text-center">WhatsApp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Next Step</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleLeads.map((lead) => {
                      const hasWhatsapp =
                        (lead as { hasWhatsapp?: boolean }).hasWhatsapp ??
                        (typeof lead.whatsapp === "string" &&
                          lead.whatsapp.length > 0);
                      // Always recompute locally so the column reflects the
                      // current optimistic status without a server round-trip.
                      const nextStep = nextStepFor(lead.leadStatus);
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
                          className={rowHighlightClass(lead.leadStatus)}
                        >
                          <TableCell>
                            <div className="font-medium">
                              {lead.fullName ?? "—"}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {lead.referenceNumber}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">
                            {visaTypeLabel(lead.immigrationSituation)}
                          </TableCell>
                          <TableCell className="text-center">
                            {whatsappCell(hasWhatsapp)}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={lead.leadStatus}
                              onValueChange={(v) =>
                                patchLead(lead.id, { status: v })
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[10rem] text-xs"
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
                          </TableCell>
                          <TableCell>
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
                          </TableCell>
                          <TableCell>
                            {nextStep ? (
                              <Badge
                                variant="outline"
                                className="font-normal text-xs whitespace-nowrap"
                                data-testid={`next-step-${lead.referenceNumber}`}
                              >
                                {nextStep}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                            {format(new Date(lead.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
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
                              <Link href={`/admin/lead/${lead.id}`}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`link-lead-${lead.referenceNumber}`}
                                >
                                  View
                                </Button>
                              </Link>
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

      <SendUpdateDialog
        target={sendUpdateTarget}
        onClose={() => setSendUpdateTarget(null)}
        onUnauthorized={clearAdminToken}
      />
    </div>
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
        `${import.meta.env.BASE_URL}api/admin/leads/${target.id}/send-update`,
        {
          method: "POST",
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
