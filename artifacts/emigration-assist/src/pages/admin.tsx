import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetStatsSummary,
  type Lead,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Lowercase canonical enums shared with the server (see classification.ts).
const STATUS_VALUES = [
  "new",
  "reviewing",
  "contacted",
  "qualified",
  "converted",
  "closed",
] as const;
const PRIORITY_VALUES = ["high", "medium", "low"] as const;

const PRIORITY_OPTIONS = [
  { value: "ALL", label: "All priorities" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
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

// Visual cues for the priority badge — high = red, medium = orange, low = grey.
function priorityBadgeClass(priority: string | null | undefined): string {
  if (priority === "high")
    return "bg-red-600 hover:bg-red-700 text-white border-transparent";
  if (priority === "medium")
    return "bg-orange-500 hover:bg-orange-600 text-white border-transparent";
  if (priority === "low")
    return "bg-gray-400 hover:bg-gray-500 text-white border-transparent";
  return "bg-muted text-muted-foreground border-transparent";
}

function priorityLabel(priority: string | null | undefined): string {
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

// Order used by the "priority first" sort: high > medium > low > unknown.
const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function priorityRank(p: string | null | undefined): number {
  return p && p in PRIORITY_RANK ? PRIORITY_RANK[p]! : 99;
}

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
  const patchLead = async (
    id: string,
    patch: { status?: string; priority?: string },
  ): Promise<boolean> => {
    const token = getAdminToken();
    if (!token) return false;

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
      return true;
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
      return false;
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

  const priorityCount = (key: string) =>
    stats?.byPriority?.find((c) => c.category === key)?.count ?? 0;

  return (
    <div className="min-h-screen bg-muted/20 p-6 md:p-12">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Lead Dashboard</h1>
            <p className="text-muted-foreground">
              Pre-launch lead monitoring tool. Internal use only — manage
              status and priority directly from the table.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={handleSendUpdateEmail}
              disabled={sendingUpdate}
              data-testid="button-send-update-email"
            >
              {sendingUpdate ? "Sending..." : "Send Update Email"}
            </Button>
            <Button
              onClick={handleExportCsv}
              disabled={exportingCsv}
              data-testid="button-export-leads"
            >
              {exportingCsv ? "Exporting…" : "Export Leads (CSV)"}
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total leads</CardDescription>
              <CardTitle className="text-3xl">
                {stats?.totalAssessments ?? 0}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>High priority</CardDescription>
              <CardTitle
                className="text-3xl text-red-600"
                data-testid="stat-priority-high"
              >
                {priorityCount("high")}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Medium priority</CardDescription>
              <CardTitle
                className="text-3xl text-orange-500"
                data-testid="stat-priority-medium"
              >
                {priorityCount("medium")}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Low priority</CardDescription>
              <CardTitle
                className="text-3xl text-gray-500"
                data-testid="stat-priority-low"
              >
                {priorityCount("low")}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

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
            <CardTitle>Leads</CardTitle>
            <CardDescription>
              Inline editor — change status or priority directly in the table.
              Updates apply optimistically and persist via an admin-only
              endpoint.
            </CardDescription>
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
                      return (
                        <TableRow
                          key={lead.id}
                          data-testid={`row-lead-${lead.referenceNumber}`}
                          data-has-whatsapp={hasWhatsapp ? "true" : "false"}
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
                                {STATUS_VALUES.map((s) => (
                                  <SelectItem
                                    key={s}
                                    value={s}
                                    className="capitalize"
                                  >
                                    {s}
                                  </SelectItem>
                                ))}
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
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                            {format(new Date(lead.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
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
