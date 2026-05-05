import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/home";
import { Assessment } from "@/pages/assessment";
import { ThankYou } from "@/pages/thank-you";
import { Status } from "@/pages/status";
import { Admin } from "@/pages/admin";
import { AdminLeadDetail } from "@/pages/admin-lead-detail";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/assessment" component={Assessment} />
      <Route path="/thank-you/:reference" component={ThankYou} />
      <Route path="/status" component={Status} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/lead/:id" component={AdminLeadDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
