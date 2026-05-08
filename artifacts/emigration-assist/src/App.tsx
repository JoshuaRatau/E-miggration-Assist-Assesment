import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthProvider, RequireAdminAuth } from "@/lib/adminAuth";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/home";
import { Assessment } from "@/pages/assessment";
import { ThankYou } from "@/pages/thank-you";
import { Status } from "@/pages/status";
import { Admin } from "@/pages/admin";
import { AdminLeadDetail } from "@/pages/admin-lead-detail";
import { AdminCaseDetail } from "@/pages/admin-case-detail";
import { AdminLogin } from "@/pages/admin-login";
import { AdminForgot } from "@/pages/admin-forgot";
import { AdminReset } from "@/pages/admin-reset";
import { AdminProfile } from "@/pages/admin-profile";
import { AdminUsers } from "@/pages/admin-users";
import { AdminImport } from "@/pages/admin-import";
import { AdminCommunications } from "@/pages/admin-communications";
import { AdminCampaignEditor } from "@/pages/admin-campaign-editor";
import { AdminCampaignDetail } from "@/pages/admin-campaign-detail";
import {
  AdminAnalytics,
  AdminReports,
  AdminSubscriptions,
  AdminSupport,
  AdminPipelines,
} from "@/pages/admin-stub";
import { AdminExports } from "@/pages/admin-exports";

/** Phase C — legacy /admin/campaigns/* paths now live under
 *  /admin/communications/*. We replace history (no back-button bounce)
 *  so old bookmarks resolve cleanly. */
function LegacyCampaignsRedirect() {
  const [, setLocation] = useLocation();
  const [, editParams] = useRoute<{ id: string }>("/admin/campaigns/:id/edit");
  const [, detailParams] = useRoute<{ id: string }>("/admin/campaigns/:id");
  useEffect(() => {
    if (editParams?.id) {
      setLocation(
        `/admin/communications/campaigns/${editParams.id}/edit`,
        { replace: true },
      );
    } else if (detailParams?.id) {
      setLocation(
        `/admin/communications/campaigns/${detailParams.id}`,
        { replace: true },
      );
    } else {
      setLocation("/admin/communications", { replace: true });
    }
  }, [editParams?.id, detailParams?.id, setLocation]);
  return null;
}

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/assessment" component={Assessment} />
      <Route path="/thank-you/:reference" component={ThankYou} />
      <Route path="/status" component={Status} />

      {/* Public admin auth pages — outside RequireAdminAuth so the
          login flow can render them without redirecting back to itself. */}
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/forgot" component={AdminForgot} />
      <Route path="/admin/reset/:token" component={AdminReset} />

      {/* Authenticated admin surface. Each protected page is wrapped
          individually so the loading shimmer is local to that route. */}
      <Route path="/admin">
        <RequireAdminAuth>
          <Admin />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/profile">
        <RequireAdminAuth>
          <AdminProfile />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/users">
        <RequireAdminAuth>
          <AdminUsers />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/import">
        <RequireAdminAuth>
          <AdminImport />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/lead/:id">
        <RequireAdminAuth>
          <AdminLeadDetail />
        </RequireAdminAuth>
      </Route>
      {/* Legacy /admin/campaigns/* — redirect to /admin/communications/*.
          Order matters: more specific routes must come first. */}
      <Route path="/admin/campaigns/:id/edit" component={LegacyCampaignsRedirect} />
      <Route path="/admin/campaigns/:id" component={LegacyCampaignsRedirect} />
      <Route path="/admin/campaigns" component={LegacyCampaignsRedirect} />

      <Route path="/admin/communications">
        <RequireAdminAuth>
          <AdminCommunications />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/communications/templates">
        <RequireAdminAuth>
          <AdminCommunications />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/communications/notifications">
        <RequireAdminAuth>
          <AdminCommunications />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/communications/reports">
        <RequireAdminAuth>
          <AdminCommunications />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/communications/campaigns/:id/edit">
        <RequireAdminAuth>
          <AdminCampaignEditor />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/communications/campaigns/:id">
        <RequireAdminAuth>
          <AdminCampaignDetail />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/case/:caseId">
        <RequireAdminAuth>
          <AdminCaseDetail />
        </RequireAdminAuth>
      </Route>

      {/* Phase 5 chrome v2 — module placeholder pages exposed via the
          workspace launcher dropdown. Real implementations land in
          subsequent phases; for now they render a clean stub inside
          AdminLayout so the menu items don't dead-click. */}
      <Route path="/admin/analytics">
        <RequireAdminAuth>
          <AdminAnalytics />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/reports">
        <RequireAdminAuth>
          <AdminReports />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/subscriptions">
        <RequireAdminAuth>
          <AdminSubscriptions />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/support">
        <RequireAdminAuth>
          <AdminSupport />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/pipelines">
        <RequireAdminAuth>
          <AdminPipelines />
        </RequireAdminAuth>
      </Route>
      <Route path="/admin/exports">
        <RequireAdminAuth>
          <AdminExports />
        </RequireAdminAuth>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AdminAuthProvider>
            <Router />
          </AdminAuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
