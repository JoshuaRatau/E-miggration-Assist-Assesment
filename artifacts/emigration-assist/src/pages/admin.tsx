import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListLeads,
  useGetStatsSummary,
  getListLeadsQueryKey,
  type Lead,
  type ListLeadsParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
];

const SITUATION_OPTIONS = [
  { value: "ALL", label: "All situations" },
  { value: "valid", label: "Valid visa" },
  { value: "expired", label: "Expired visa" },
  { value: "overstay", label: "Overstay" },
  { value: "undesirable", label: "Undesirable" },
  { value: "prohibited", label: "Prohibited" },
  { value: "unknown", label: "Unknown" },
];

const WHATSAPP_OPTIONS = [
  { value: "ANY", label: "WhatsApp: Any" },
  { value: "HAS", label: "WhatsApp: Has" },
  { value: "NONE", label: "WhatsApp: None" },
];

function whatsappBadge(hasWhatsapp: boolean) {
  if (hasWhatsapp) {
    return (
      <Badge
        className="bg-green-600 hover:bg-green-700 text-white border-transparent"
        aria-label="Has WhatsApp"
      >
        ✓ WhatsApp
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      aria-label="No WhatsApp"
    >
      —
    </Badge>
  );
}

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

export function Admin() {
  useEffect(() => {
    document.title = "Admin Overview | E-Migration Assist";
  }, []);

  const [priority, setPriority] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [situation, setSituation] = useState("ALL");
  const [nationality, setNationality] = useState("");
  const [whatsappFilter, setWhatsappFilter] = useState("ANY");

  const queryParams: ListLeadsParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: 200 };
    if (priority !== "ALL") p.priority = priority;
    if (status !== "ALL") p.status = status;
    if (situation !== "ALL") p.situation = situation;
    if (nationality.trim()) p.nationality = nationality.trim();
    return p as ListLeadsParams;
  }, [priority, status, situation, nationality]);

  const { data: leads, isLoading } = useListLeads(queryParams);
  const listQueryKey = useMemo(
    () => getListLeadsQueryKey(queryParams),
    [queryParams],
  );

  // Client-side WhatsApp filter — applied over the already-fetched list so the
  // server contract is unchanged. `hasWhatsapp` comes from the serialized lead;
  // we also fall back to checking the raw `whatsapp` field for resilience.
  const filteredLeads = useMemo(() => {
    if (!leads) return leads;
    if (whatsappFilter === "ANY") return leads;
    return leads.filter((l) => {
      const has =
        (l as { hasWhatsapp?: boolean }).hasWhatsapp ??
        (typeof l.whatsapp === "string" && l.whatsapp.length > 0);
      return whatsappFilter === "HAS" ? has : !has;
    });
  }, [leads, whatsappFilter]);
  const { data: stats } = useGetStatsSummary();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sendingUpdate, setSendingUpdate] = useState(false);
  // Per-row "Send update" dialog target. Null = dialog closed. The dialog is
  // rendered once at page level (see SendUpdateDialog) and switched between
  // leads via this state, so we don't pay for one Radix portal per row.
  const [sendUpdateTarget, setSendUpdateTarget] = useState<{
    id: string;
    referenceNumber: string;
    email: string | null;
    whatsapp: string | null;
  } | null>(null);

  const exportHref = `${import.meta.env.BASE_URL}api/leads/export.csv`;
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
    patch: { status?: string; priority?: string; notes?: string | null },
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
              ...(patch.notes !== undefined ? { adminNotes: patch.notes } : {}),
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
            <h1 className="text-3xl font-display font-bold">Admin Overview</h1>
            <p className="text-muted-foreground">
              Pre-launch lead monitoring tool. Internal use only — categories,
              scores and priorities shown here are internal classifications and
              are not displayed to users.
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
            <Button asChild data-testid="button-export-leads">
              <a href={exportHref} download>
                Export Leads (CSV)
              </a>
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
            <CardTitle>Filter</CardTitle>
            <CardDescription>
              Narrow the lead list by priority, status, nationality, situation
              or WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-5">
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
                  Situation
                </label>
                <Select value={situation} onValueChange={setSituation}>
                  <SelectTrigger data-testid="select-filter-situation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SITUATION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Nationality
                </label>
                <input
                  type="text"
                  placeholder="e.g. Zimbabwean"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="input-filter-nationality"
                />
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Assessments</CardTitle>
            <CardDescription>
              Inline CRM editor — change status, priority or notes directly in
              the table. Updates apply optimistically and persist via an
              admin-only endpoint.
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
            ) : !filteredLeads || filteredLeads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
                No assessments match the current filters.
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Nationality</TableHead>
                      <TableHead>Situation</TableHead>
                      <TableHead>WhatsApp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="min-w-[14rem]">Notes</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeads.map((lead) => {
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
                          <TableCell className="font-mono text-xs font-medium">
                            {lead.referenceNumber}
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {format(new Date(lead.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>{lead.nationality}</TableCell>
                          <TableCell className="capitalize">
                            {lead.immigrationSituation?.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell>{whatsappBadge(hasWhatsapp)}</TableCell>
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
                          <TableCell>
                            <NotesCell
                              leadId={lead.id}
                              referenceNumber={lead.referenceNumber}
                              initial={lead.adminNotes ?? ""}
                              onSave={(value) =>
                                patchLead(lead.id, {
                                  notes: value === "" ? null : value,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
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
            ? "WhatsApp is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN secrets, then re-send."
            : body.reason === "missing_permission"
              ? "The WhatsApp token is missing the 'whatsapp_business_messaging' permission. Update the token's scopes in Meta and re-send."
              : body.reason === "invalid_credentials"
                ? "WhatsApp rejected the token. Check WHATSAPP_TOKEN (it may be expired or revoked) and re-send."
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

/**
 * Inline notes cell.  The textarea is uncontrolled-after-mount: the parent's
 * `initial` value seeds local state, and we only call `onSave` when the cell
 * loses focus AND the value actually changed.  This avoids a network round
 * trip on every keystroke and avoids fighting React Query's refetches.
 */
function NotesCell({
  leadId,
  referenceNumber,
  initial,
  onSave,
}: {
  leadId: string;
  referenceNumber: string;
  initial: string;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  // Re-sync if the parent's authoritative value changes (e.g. after a refetch
  // or another tab updates the lead).  Skip if the user has unsaved edits.
  useEffect(() => {
    if (value === savedValue) {
      setValue(initial);
      setSavedValue(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const handleBlur = async () => {
    if (value === savedValue) return;
    setSaving(true);
    const ok = await onSave(value);
    setSaving(false);
    if (ok) {
      setSavedValue(value);
    } else {
      setValue(savedValue);
    }
  };

  // Suppress unused warning — leadId is exposed for future analytics hooks.
  void leadId;

  return (
    <Textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      placeholder="Notes…"
      rows={2}
      className="min-h-[2.5rem] text-xs resize-y"
      disabled={saving}
      data-testid={`textarea-notes-${referenceNumber}`}
    />
  );
}
