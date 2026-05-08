import { useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Phase 5 chrome v2 — Exports module.
 *
 * Centralised home for export operations. Phase 5C surfaced "Export Leads
 * (CSV)" as a topbar button on the dashboard; chrome v2 removes that
 * topbar action and houses it here. Future phases will add scheduled
 * exports, history of generated files, and additional export types
 * (campaigns, communications, audit trail).
 *
 * The CSV endpoint (GET /api/admin/leads/export) is unchanged — this
 * page just calls it via cookie auth and triggers a browser download.
 */

export function AdminExports() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExportLeadsCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Mirrors admin.tsx handleExportCsv — endpoint is GET
      // /api/leads/export.csv, auth flows via the legacy x-admin-token
      // header which the cookie-auth shim populates with "cookie-auth"
      // (the cookie itself is sent automatically; the header is harmless).
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/leads/export.csv`,
        { credentials: "include" },
      );
      if (!res.ok) {
        toast({
          title: "Export failed",
          description: `Server returned ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().slice(0, 10);
      a.download = `ema-leads-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch {
      toast({
        title: "Export failed",
        description: "Network error — please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminLayout title="Exports">
      <div className="max-w-4xl mx-auto py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-display font-semibold">Exports</h1>
          <p className="text-sm text-muted-foreground">
            Download point-in-time data extracts. Scheduled exports and full
            export history are planned for a future phase.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Download className="h-4 w-4" aria-hidden="true" />
                Leads (CSV)
              </CardTitle>
              <CardDescription>
                Snapshot of every lead row visible in the Dashboard with all
                CRM fields. Generated on demand.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                onClick={handleExportLeadsCsv}
                disabled={exporting}
                data-testid="button-export-leads-csv"
              >
                {exporting ? "Exporting…" : "Download CSV"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/40 opacity-60">
            <CardHeader>
              <CardTitle className="text-lg">Campaigns</CardTitle>
              <CardDescription>
                Campaign send histories and per-recipient delivery state — coming soon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" disabled>
                Coming soon
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/40 opacity-60">
            <CardHeader>
              <CardTitle className="text-lg">Audit trail</CardTitle>
              <CardDescription>
                Privileged-mutation audit log export for compliance reviews —
                coming soon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" disabled>
                Coming soon
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
