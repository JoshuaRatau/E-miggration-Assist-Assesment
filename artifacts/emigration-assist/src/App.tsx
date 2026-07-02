import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { trackPixel } from "@/lib/metaPixel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SupportWidget } from "@/components/support-widget";
import { AdminAuthProvider, RequireAdminAuth } from "@/lib/adminAuth";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/home";
import Pricing from "@/pages/pricing";
import { Assessment } from "@/pages/assessment";
import OverstayAssessment from "@/pages/overstay-assessment";
import BusinessAssessment from "@/pages/business-assessment";
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
  AdminSupport,
  AdminPipelines,
} from "@/pages/admin-stub";
import { AdminSubscriptions } from "@/pages/admin-subscriptions";
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

/** Public content pages that warrant a `ViewContent` event (path → safe params). */
const CONTENT_PAGES: Record<string, { name: string; category: string }> = {
  "/": { name: "Home", category: "home" },
  "/pricing": { name: "Pricing", category: "pricing" },
  "/prices": { name: "Pricing", category: "pricing" },
  "/assessment": { name: "Visa Assessment", category: "assessment" },
  "/overstay-assessment": { name: "Overstay Assessment", category: "assessment" },
  "/overstay": { name: "Overstay Assessment", category: "assessment" },
};

// Module-scoped so it survives component unmount/remount (e.g. React
// StrictMode dev remounts), preventing duplicate PageView/ViewContent for the
// same path. Tracks only the most-recent path, so re-navigating to a page
// still fires correctly.
let lastTrackedPixelPath: string | null = null;

/**
 * Fires Meta Pixel `PageView` on SPA navigations (the initial load is already
 * tracked by the base snippet in index.html) and `ViewContent` on key public
 * content pages.
 */
function PixelPageTracker() {
  const [location] = useLocation();
  useEffect(() => {
    if (lastTrackedPixelPath === location) return;
    const isFirstLoad = lastTrackedPixelPath === null;
    lastTrackedPixelPath = location;
    if (!isFirstLoad) trackPixel("PageView");
    const content = CONTENT_PAGES[location];
    if (content) {
      trackPixel("ViewContent", {
        content_name: content.name,
        content_category: content.category,
      });
    }
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/prices" component={Pricing} />
      <Route path="/assessment" component={Assessment} />
      <Route path="/overstay-assessment" component={OverstayAssessment} />
      <Route path="/overstay" component={OverstayAssessment} />
      <Route path="/business-assessment" component={BusinessAssessment} />
      <Route path="/business" component={BusinessAssessment} />
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
      <Route path="/admin/communications/automations">
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
          <PixelPageTracker />
          <AdminAuthProvider>
            <Router />
          </AdminAuthProvider>
        </WouterRouter>
        <SupportWidget />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
