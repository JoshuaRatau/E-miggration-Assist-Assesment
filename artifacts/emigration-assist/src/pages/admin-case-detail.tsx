import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";
import { statusLabel } from "@/lib/leadStatus";

type CaseDetail = {
  id: string;
  leadId: string;
  referenceNumber: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  nextStep: string | null;
  lead: {
    id: string;
    referenceNumber: string;
    fullName: string | null;
    email: string | null;
    whatsapp: string | null;
    nationality: string | null;
    countryOfResidence: string | null;
    immigrationSituation: string | null;
    leadStatus: string;
    leadPriority: string | null;
    adminNotes: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function AdminCaseDetail() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const { toast } = useToast();

  const [caseRow, setCaseRow] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setError("Admin token required. Visit /admin to sign in first.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/admin/cases/${caseId}`, {
          headers: { "x-admin-token": token },
        });
        if (!res.ok) {
          if (res.status === 401) {
            clearAdminToken();
            throw new Error("Admin token rejected — please sign in again.");
          }
          if (res.status === 404) throw new Error("Case not found");
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `Server returned ${res.status}`);
        }
        const data = (await res.json()) as CaseDetail;
        if (!cancelled) setCaseRow(data);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load case";
          setError(message);
          toast({
            title: "Could not load case",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, toast]);

  if (loading) {
    return (
      <div className="container mx-auto p-8" data-testid="case-loading">
        Loading case…
      </div>
    );
  }

  if (error || !caseRow) {
    return (
      <div className="container mx-auto p-8 space-y-4">
        <p className="text-destructive" data-testid="case-error">
          {error ?? "Case unavailable"}
        </p>
        <Link href="/admin">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div
      className="container mx-auto p-6 space-y-6 max-w-4xl"
      data-testid="case-detail"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Case {caseRow.referenceNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            Lightweight case linked to lead{" "}
            <Link href={`/admin/lead/${caseRow.leadId}`}>
              <a
                className="underline"
                data-testid="link-back-to-lead"
              >
                {caseRow.lead.referenceNumber}
              </a>
            </Link>
          </p>
        </div>
        <Link href="/admin">
          <Button variant="outline" data-testid="link-back-to-admin">
            Back to dashboard
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Case</CardTitle>
          <CardDescription>Status &amp; next step</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Case reference</div>
            <div className="font-medium" data-testid="case-reference">
              {caseRow.referenceNumber}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Case status</div>
            <Badge variant="secondary" data-testid="case-status">
              {statusLabel(caseRow.status)}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground">Lead status</div>
            <Badge data-testid="case-lead-status">
              {statusLabel(caseRow.lead.leadStatus)}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground">Next step</div>
            <div data-testid="case-next-step">
              {caseRow.nextStep ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Created</div>
            <div data-testid="case-created-at">
              {format(new Date(caseRow.createdAt), "PPP p")}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Last updated</div>
            <div>{format(new Date(caseRow.updatedAt), "PPP p")}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Original lead</CardTitle>
          <CardDescription>Snapshot from prelaunch_leads</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Full name</div>
            <div data-testid="case-lead-name">
              {caseRow.lead.fullName ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Email</div>
            <div>{caseRow.lead.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">WhatsApp</div>
            <div>{caseRow.lead.whatsapp ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Nationality</div>
            <div>{caseRow.lead.nationality ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Country of residence</div>
            <div>{caseRow.lead.countryOfResidence ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Immigration situation</div>
            <div>{caseRow.lead.immigrationSituation ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Priority</div>
            <div>{caseRow.lead.leadPriority ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Lead created</div>
            <div>{format(new Date(caseRow.lead.createdAt), "PPP p")}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
          <CardDescription>
            Internal operator notes (from the lead record).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p
            className="whitespace-pre-wrap text-sm"
            data-testid="case-notes"
          >
            {caseRow.lead.adminNotes && caseRow.lead.adminNotes.trim().length > 0
              ? caseRow.lead.adminNotes
              : "No notes recorded."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
