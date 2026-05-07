import { Switch, Route, Router as WouterRouter } from "wouter";
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
      <Route path="/admin/case/:caseId">
        <RequireAdminAuth>
          <AdminCaseDetail />
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
