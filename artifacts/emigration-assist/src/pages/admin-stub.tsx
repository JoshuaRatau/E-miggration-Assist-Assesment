import { type ReactNode } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, FileBarChart, LifeBuoy, Download, KanbanSquare } from "lucide-react";

/**
 * Phase 5 chrome v2 — module placeholder pages.
 *
 * The launcher dropdown lists 12 modules; 5 of them don't have real
 * implementations yet (Analytics, Reports, Subscriptions, Customer Support,
 * Pipelines). Rather than letting their menu items dead-click, each one
 * routes to a dedicated placeholder so users see an honest "this module is
 * planned" surface inside the same AdminLayout chrome.
 *
 * The Exports stub IS functional in a small way — it exposes the existing
 * CSV export action (lifted out of the dashboard topbar in chrome v2) so
 * operators have a single home for export operations.
 */

function StubShell({
  title,
  Icon,
  blurb,
  children,
}: {
  title: string;
  Icon: typeof BarChart3;
  blurb: string;
  children?: ReactNode;
}) {
  return (
    <AdminLayout title={title}>
      <div className="max-w-3xl mx-auto py-12">
        <Card className="border-border/40">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-2xl font-display">{title}</CardTitle>
            </div>
            <CardDescription className="text-base">{blurb}</CardDescription>
          </CardHeader>
          {children ? <CardContent className="space-y-4">{children}</CardContent> : null}
        </Card>
      </div>
    </AdminLayout>
  );
}

export function AdminAnalytics() {
  return (
    <StubShell
      title="Analytics"
      Icon={BarChart3}
      blurb="Lead funnel analytics, conversion ratios, segment performance — coming in Phase 6. The current snapshot stats live on the Dashboard."
    >
      <Link href="/admin">
        <Button variant="outline" size="sm" data-testid="button-stub-to-dashboard">
          Open Dashboard snapshot
        </Button>
      </Link>
    </StubShell>
  );
}

export function AdminReports() {
  return (
    <StubShell
      title="Reports"
      Icon={FileBarChart}
      blurb="Operational reporting (campaign performance, communications throughput, lead-source ROI). The Communications hub already exposes a Reports tab as a starting point."
    >
      <Link href="/admin/communications/reports">
        <Button variant="outline" size="sm" data-testid="button-stub-to-comms-reports">
          Open Communications → Reports
        </Button>
      </Link>
    </StubShell>
  );
}

export function AdminSupport() {
  return (
    <StubShell
      title="Customer Support"
      Icon={LifeBuoy}
      blurb="Inbound support inbox and ticket queue — planned for Phase 7. WhatsApp inbound currently routes into per-case message threads under Lead detail."
    />
  );
}

export function AdminPipelines() {
  return (
    <StubShell
      title="Pipelines"
      Icon={KanbanSquare}
      blurb="The kanban pipeline board lives on the Dashboard alongside the leads table so operators can switch context without losing filters. A standalone full-screen pipeline view is planned for Phase 6."
    >
      <Link href="/admin">
        <Button variant="outline" size="sm" data-testid="button-stub-to-dashboard-pipeline">
          Open Dashboard pipeline
        </Button>
      </Link>
    </StubShell>
  );
}
