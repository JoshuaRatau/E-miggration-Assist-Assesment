import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListLeads,
  useGetStatsSummary,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
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

const PRIORITY_OPTIONS = [
  { value: "ALL", label: "All priorities" },
  { value: "HIGH_PRIORITY", label: "High" },
  { value: "MEDIUM_PRIORITY", label: "Medium" },
  { value: "LOW_PRIORITY", label: "Low" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "NEW", label: "New" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "NEEDS_FOLLOW_UP", label: "Needs follow-up" },
  { value: "WAITLISTED", label: "Waitlisted" },
  { value: "NOT_RELEVANT", label: "Not relevant" },
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

function priorityBadge(priority: string | null | undefined) {
  if (priority === "HIGH_PRIORITY") {
    return (
      <Badge className="bg-red-600 hover:bg-red-700 text-white border-transparent">
        HIGH
      </Badge>
    );
  }
  if (priority === "MEDIUM_PRIORITY") {
    return (
      <Badge className="bg-orange-500 hover:bg-orange-600 text-white border-transparent">
        MEDIUM
      </Badge>
    );
  }
  if (priority === "LOW_PRIORITY") {
    return (
      <Badge className="bg-gray-400 hover:bg-gray-500 text-white border-transparent">
        LOW
      </Badge>
    );
  }
  return <Badge variant="outline">—</Badge>;
}

function statusBadge(status: string | null | undefined) {
  const s = status ?? "NEW";
  const variantMap: Record<string, "default" | "secondary" | "outline"> = {
    NEW: "default",
    REVIEWED: "secondary",
    NEEDS_FOLLOW_UP: "default",
    WAITLISTED: "outline",
    NOT_RELEVANT: "outline",
  };
  return (
    <Badge variant={variantMap[s] ?? "outline"} className="whitespace-nowrap">
      {s.replace(/_/g, " ")}
    </Badge>
  );
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

  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: 200 };
    if (priority !== "ALL") p.priority = priority;
    if (status !== "ALL") p.status = status;
    if (situation !== "ALL") p.situation = situation;
    if (nationality.trim()) p.nationality = nationality.trim();
    return p;
  }, [priority, status, situation, nationality]);

  const { data: leads, isLoading } = useListLeads(queryParams as never);

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
  const [sendingUpdate, setSendingUpdate] = useState(false);

  const exportHref = `${import.meta.env.BASE_URL}api/leads/export.csv`;
  const sendUpdateUrl = `${import.meta.env.BASE_URL}api/admin/email/update`;

  const handleSendUpdateEmail = async () => {
    if (sendingUpdate) return;

    let token = sessionStorage.getItem("ema-admin-token") ?? "";
    if (!token) {
      const entered = window.prompt("Enter the admin email token");
      if (!entered) return;
      token = entered.trim();
      if (!token) return;
      sessionStorage.setItem("ema-admin-token", token);
    }

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
          sessionStorage.removeItem("ema-admin-token");
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
              <CardTitle className="text-3xl text-red-600">
                {priorityCount("HIGH_PRIORITY")}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Medium priority</CardDescription>
              <CardTitle className="text-3xl text-orange-500">
                {priorityCount("MEDIUM_PRIORITY")}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Low priority</CardDescription>
              <CardTitle className="text-3xl text-gray-500">
                {priorityCount("LOW_PRIORITY")}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
            <CardDescription>
              Narrow the lead list by priority, status, nationality or situation.
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
              Internal classification, score, priority, status and public-facing
              label per submission.
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
                      <TableHead>Internal Category</TableHead>
                      <TableHead>Public Label</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Score</TableHead>
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
                          <code className="text-xs font-mono text-muted-foreground">
                            {lead.internalClassification || "—"}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="whitespace-nowrap">
                            {lead.leadCategory || "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell>{priorityBadge(lead.leadPriority)}</TableCell>
                        <TableCell>{statusBadge(lead.leadStatus)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {lead.leadScore ?? 0}
                        </TableCell>
                        <TableCell>
                          <Link href={`/admin/lead/${lead.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`link-lead-${lead.referenceNumber}`}
                            >
                              View
                            </Button>
                          </Link>
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
  );
}
