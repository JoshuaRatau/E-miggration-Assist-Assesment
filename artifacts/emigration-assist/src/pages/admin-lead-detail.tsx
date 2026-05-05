import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetLeadById,
  getGetLeadByIdQueryKey,
  type Lead,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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

const STATUS_OPTIONS = [
  "new",
  "reviewing",
  "contacted",
  "converted",
  "closed",
] as const;

const PRIORITY_OPTIONS = ["high", "medium", "low"] as const;

function priorityBadgeClass(priority: string | null | undefined): string {
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

  const { data: lead, isLoading, isError } = useGetLeadById(id);

  const [leadStatus, setLeadStatus] = useState<string>("new");
  const [leadPriority, setLeadPriority] = useState<string>("medium");
  const [adminNotes, setAdminNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Lead Detail | E-Migration Assist";
  }, []);

  useEffect(() => {
    if (lead) {
      setLeadStatus(lead.leadStatus ?? "new");
      setLeadPriority(lead.leadPriority ?? "medium");
      setAdminNotes(lead.adminNotes ?? "");
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
      qc.setQueryData(getGetLeadByIdQueryKey(id), updated);
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
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
      <div className="min-h-screen bg-muted/20 p-6 md:p-12">
        <div className="max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !lead) {
    return (
      <div className="min-h-screen bg-muted/20 p-6 md:p-12">
        <div className="max-w-5xl mx-auto space-y-4">
          <Link href="/admin">
            <Button variant="ghost">← Back to admin</Button>
          </Link>
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Lead not found.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
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
            <Field label="Score" value={lead.leadScore ?? 0} />
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
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
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
      </div>
    </div>
  );
}
