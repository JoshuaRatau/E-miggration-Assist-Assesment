import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { type Lead } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { DocumentUploader } from "@/components/DocumentUploader";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";
import { canAdvanceStatus, statusLabel } from "@/lib/leadStatus";
import { INTENDED_TIER_VALUES, TIER_LABEL } from "@/lib/intendedTier";
import { AdminLayout } from "@/components/admin-layout";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { LeadActivityPanel } from "@/components/lead-activity-panel";

const STATUS_OPTIONS = [
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

const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"] as const;

function priorityBadgeClass(priority: string | null | undefined): string {
  if (priority === "critical")
    return "bg-pink-700 text-white border-transparent";
  if (priority === "high")
    return "bg-red-600 text-white border-transparent";
  if (priority === "medium")
    return "bg-orange-500 text-white border-transparent";
  if (priority === "low")
    return "bg-gray-400 text-white border-transparent";
  return "bg-muted text-muted-foreground border-transparent";
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="text-sm">
        {value === null || value === undefined || value === "" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

export function AdminLeadDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const qc = useQueryClient();

  // GET /api/leads/by-id/:id is admin-gated (returns PII).  We can't use the
  // Orval-generated `useGetLeadById` because it has no header-injection hook,
  // so we use React Query directly with a custom fetch + admin token.
  const leadQueryKey = ["admin", "lead", id] as const;
  const {
    data: lead,
    isLoading,
    isError,
  } = useQuery<Lead, Error>({
    queryKey: leadQueryKey,
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/leads/by-id/${id}`,
        { headers: { "x-admin-token": token } },
      );
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return (await res.json()) as Lead;
    },
  });

  const [leadStatus, setLeadStatus] = useState<string>("new");
  const [leadPriority, setLeadPriority] = useState<string>("medium");
  const [adminNotes, setAdminNotes] = useState<string>("");
  // Phase 6A.5 — local draft for the intended-tier dropdown. Empty
  // string is the "Unset" sentinel; persisted to the server as null
  // when the operator picks it (or saves while still empty).
  const [intendedTier, setIntendedTier] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Lead Detail | E-Migration Assist";
  }, []);

  useEffect(() => {
    if (lead) {
      setLeadStatus(lead.leadStatus ?? "new");
      setLeadPriority(lead.leadPriority ?? "medium");
      setAdminNotes(lead.adminNotes ?? "");
      setIntendedTier(lead.intendedTier ?? "");
    }
  }, [lead]);

  const handleSave = async () => {
    if (!lead) return;
    const token = getAdminToken();
    if (!token) return;

    setSaving(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/admin/leads/${id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({
            status: leadStatus,
            priority: leadPriority,
            notes: adminNotes === "" ? null : adminNotes,
            intendedTier: intendedTier === "" ? null : intendedTier,
          }),
        },
      );
      if (!res.ok) {
        if (res.status === 401) clearAdminToken();
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const updated = (await res.json()) as Lead;
      qc.setQueryData(leadQueryKey, updated);
      // Invalidate both legacy and current admin list cache shapes so any
      // open dashboard tab reconciles its row.
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      qc.invalidateQueries({ queryKey: ["admin", "leads"] });
      // Phase 6B PR 3 — also invalidate the Activity panel's events
      // query. A tier change re-routes the rubric and (post PR 4) will
      // emit a `lead_intended_tier_changed` event, both of which the
      // panel's header/card needs to reflect on next render rather than
      // waiting up to 5min for the React-Query staleTime to expire.
      qc.invalidateQueries({ queryKey: ["admin", "lead", id, "events"] });
      toast({
        title: "Lead updated",
        description: "Status, priority and notes have been saved.",
      });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout title="Lead" contentClassName="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AdminLayout>
    );
  }

  if (isError || !lead) {
    return (
      <AdminLayout title="Lead" contentClassName="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="space-y-4">
          <Link href="/admin">
            <Button variant="ghost">← Back to admin</Button>
          </Link>
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Lead not found.
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title={`Lead · ${lead.referenceNumber}`}
      contentClassName="flex-1 max-w-5xl w-full mx-auto px-6 py-8"
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/admin">
            <Button variant="ghost" data-testid="link-back-admin">
              ← Back to admin
            </Button>
          </Link>
          <code className="font-mono text-sm">{lead.referenceNumber}</code>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{lead.fullName ?? "Unnamed lead"}</CardTitle>
                <CardDescription>
                  Submitted{" "}
                  {format(new Date(lead.createdAt), "MMM d yyyy, HH:mm")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" data-testid="badge-public-label">
                  {lead.leadCategory ?? "Pending"}
                </Badge>
                <Badge
                  className={priorityBadgeClass(lead.leadPriority)}
                  data-testid="badge-priority"
                >
                  {(lead.leadPriority ?? "—").toUpperCase()}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <Field label="Internal Category" value={
              <code className="font-mono text-xs">{lead.internalClassification ?? "—"}</code>
            } />
            <Field
              label="Score"
              value={
                <LeadScoreBadge
                  lead={lead}
                  showRubric
                  testIdSuffix="lead-detail"
                />
              }
            />
            <Field label="Public Label" value={lead.leadCategory} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <Field label="Email" value={lead.email} />
            <Field label="WhatsApp" value={lead.whatsapp} />
            <Field
              label="Preferred contact"
              value={lead.preferredContactMethod}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assessment Answers</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <Field label="Nationality" value={lead.nationality} />
            <Field label="Country of residence" value={lead.countryOfResidence} />
            <Field
              label="Inside South Africa"
              value={
                lead.currentlyInSouthAfrica === true
                  ? "Yes"
                  : lead.currentlyInSouthAfrica === false
                    ? "No"
                    : null
              }
            />
            <Field label="Situation" value={lead.immigrationSituation} />
            <Field label="Passport status" value={lead.passportStatus} />
            <Field label="Visa expiry" value={lead.visaExpiryDate} />
            <Field label="Exit date" value={lead.exitDate} />
            <Field label="Border document" value={lead.borderDocumentIssued} />
            <Field label="Overstay reason" value={lead.overstayReason} />
            <Field
              label="Supporting documents"
              value={lead.hasSupportingDocuments}
            />
            <Field label="Previous overstay" value={lead.previousOverstay} />
            <Field
              label="Visa history"
              value={
                lead.visaHistory ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm">
                    {lead.visaHistory}
                  </pre>
                ) : null
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timestamps</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <Field
              label="Created"
              value={format(new Date(lead.createdAt), "MMM d yyyy, HH:mm:ss")}
            />
            <Field
              label="Last updated"
              value={format(new Date(lead.updatedAt), "MMM d yyyy, HH:mm:ss")}
            />
            <Field
              label="Consent recorded"
              value={
                lead.consentTimestamp
                  ? format(
                      new Date(lead.consentTimestamp),
                      "MMM d yyyy, HH:mm:ss",
                    )
                  : null
              }
            />
          </CardContent>
        </Card>

        <LeadActivityPanel leadId={id} />

        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>
              Files uploaded by the lead. They are stored privately and only
              served via authenticated download links from this panel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentUploader leadId={id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admin Controls</CardTitle>
            <CardDescription>
              Update the operational status, priority, and add internal notes.
              These fields are only visible inside the admin panel and are
              never exposed to the lead.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Lead status</label>
                <Select value={leadStatus} onValueChange={setLeadStatus}>
                  <SelectTrigger
                    className="md:w-72"
                    data-testid="select-lead-status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => {
                      // Disable options that would regress the funnel.
                      // Compared against the lead's CURRENT (server-saved)
                      // status — `lead?.leadStatus` — not the local draft,
                      // so once a forward step is saved it becomes the new
                      // floor for further edits.
                      const allowed = canAdvanceStatus(
                        lead?.leadStatus,
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
                          data-testid={`status-option-${s}`}
                        >
                          {statusLabel(s)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={leadPriority} onValueChange={setLeadPriority}>
                  <SelectTrigger
                    className="md:w-72"
                    data-testid="select-lead-priority"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">
                  Intended tier{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (commercial pricing tier this lead is heading toward)
                  </span>
                </label>
                <Select
                  value={intendedTier === "" ? "__unset__" : intendedTier}
                  onValueChange={(v) =>
                    setIntendedTier(v === "__unset__" ? "" : v)
                  }
                >
                  <SelectTrigger
                    className="md:w-72"
                    data-testid="select-intended-tier"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">— Not set —</SelectItem>
                    {INTENDED_TIER_VALUES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TIER_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Internal notes</label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Notes for the operations team. Not visible to the lead."
                rows={5}
                data-testid="textarea-admin-notes"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
                data-testid="button-save-lead"
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <InboundMessages leadId={id} />

        <EngagementHistory leadId={id} />
      </div>
    </AdminLayout>
  );
}

interface InboundMessageRow {
  id: string;
  leadId: string;
  direction: string;
  message: string;
  intent: string | null;
  matchedKeyword: string | null;
  waMessageId: string | null;
  createdAt: string;
}

/**
 * Inbound replies received from a lead (initially WhatsApp). Newest first.
 *
 * Mirrors `EngagementHistory` (same auth pattern, same focus-refetch
 * behaviour) but reads `case_messages` via a separate admin endpoint —
 * inbound message bodies are user-typed PII and live in their own table
 * rather than being conflated with outbound delivery audit rows.
 *
 * Phase 1 keyword detection runs server-side; if a message matched a
 * completion-signal keyword, we surface the matched keyword inline as a
 * badge so the operator can quickly scan for "the user said done".
 */
function InboundMessages({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<InboundMessageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const token = getAdminToken();
      if (!token) {
        if (!cancelled) {
          setError("Admin token required");
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${import.meta.env.BASE_URL}api/admin/leads/${leadId}/messages`,
          { headers: { "x-admin-token": token } },
        );
        if (res.status === 401) {
          clearAdminToken();
          throw new Error("Admin token rejected");
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const body = (await res.json()) as InboundMessageRow[];
        if (!cancelled) setRows(body);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [leadId]);

  return (
    <Card data-testid="card-inbound-messages">
      <CardHeader>
        <CardTitle>Inbound replies</CardTitle>
        <CardDescription>
          Messages we've received from this lead, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-inbound-error"
          >
            Could not load inbound messages: {error}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-inbound-empty"
          >
            No replies received yet.
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                data-testid={`row-inbound-${row.id}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.direction}</Badge>
                    {row.intent === "task_complete_signal" ? (
                      <Badge className="bg-emerald-600 text-white border-transparent">
                        completion signal
                        {row.matchedKeyword
                          ? ` · "${row.matchedKeyword}"`
                          : ""}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {row.message}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(row.createdAt), "PPp")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface EngagementRow {
  id: string;
  leadId: string;
  channel: string;
  type: string;
  status: string;
  message: string | null;
  createdAt: string;
}

/**
 * Read-only engagement timeline for a single lead.
 *
 * Fetches `GET /api/admin/leads/:id/engagements` (token-gated, never written
 * to the React Query cache shared with public lead data, since rows may
 * contain operator-typed message bodies). We refetch on mount and after a
 * window-focus event so an operator who sends an update from the listing
 * page sees the new row immediately when they navigate back here.
 *
 * Failure mode: if the admin token is missing or rejected, we render a
 * compact empty state rather than blocking the page — the rest of the lead
 * detail (status, priority, notes) remains usable.
 */
function EngagementHistory({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<EngagementRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const token = getAdminToken();
      if (!token) {
        if (!cancelled) {
          setError("Admin token required");
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${import.meta.env.BASE_URL}api/admin/leads/${leadId}/engagements`,
          { headers: { "x-admin-token": token } },
        );
        if (res.status === 401) {
          clearAdminToken();
          throw new Error("Admin token rejected");
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const body = (await res.json()) as EngagementRow[];
        if (!cancelled) setRows(body);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [leadId]);

  return (
    <Card data-testid="card-engagement-history">
      <CardHeader>
        <CardTitle>Engagement history</CardTitle>
        <CardDescription>
          Outbound messages we have attempted for this lead, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-engagement-error"
          >
            Could not load engagement history: {error}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-engagement-empty"
          >
            No engagements yet. Use “Send update” on the leads list to send a
            one-off message.
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                data-testid={`row-engagement-${row.id}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.type}</Badge>
                    <Badge variant="outline">{row.channel}</Badge>
                    <Badge className={statusBadgeClass(row.status)}>
                      {row.status}
                    </Badge>
                  </div>
                  {row.message ? (
                    <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {row.message}
                    </div>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(row.createdAt), "PPp")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function statusBadgeClass(status: string): string {
  if (status === "sent") return "bg-emerald-600 text-white border-transparent";
  if (status === "failed") return "bg-red-600 text-white border-transparent";
  if (status === "pending")
    return "bg-amber-500 text-white border-transparent";
  return "bg-muted text-muted-foreground border-transparent";
}
