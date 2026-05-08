import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAdminAuth } from "@/lib/adminAuth";
import {
  LayoutGrid,
  Home,
  Users2,
  KanbanSquare,
  Send,
  Megaphone,
  Upload,
  Download,
  BarChart3,
  FileBarChart,
  CreditCard,
  LifeBuoy,
  Settings,
  Shield,
} from "lucide-react";

/**
 * Phase 5 chrome v2 — workspace launcher dropdown.
 *
 * Sits in the AdminLayout topbar (right-of-actions, left-of-AdminUserMenu)
 * and exposes the FULL module list. The persistent left sidebar carries
 * the daily-driver subset only (Dashboard / Communications / Imports /
 * Manage Admins / Settings); the launcher is the single source of truth
 * for "what modules exist."
 *
 * Items map either to first-class pages or to alias/stub routes:
 *   - Leads          → /admin           (the dashboard IS the leads view)
 *   - Pipelines      → /admin/pipelines (placeholder, deep-links to board)
 *   - Campaigns      → /admin/communications (the Campaigns tab IS the
 *                      default tab — no separate /campaigns list route
 *                      exists; campaign editor/detail live under
 *                      /admin/communications/campaigns/:id[/edit])
 *   - Analytics      → /admin/analytics (placeholder)
 *   - Reports        → /admin/reports (placeholder)
 *   - Subscriptions  → /admin/subscriptions (placeholder)
 *   - Support        → /admin/support (placeholder)
 *   - Exports        → /admin/exports (real: surfaces CSV export action)
 *   - Settings       → /admin/profile (route kept, label rebranded)
 */

type LauncherItem = {
  href: string;
  label: string;
  Icon: typeof Home;
  testId: string;
  superOnly?: boolean;
};

const ITEMS: LauncherItem[] = [
  { href: "/admin", label: "Dashboard", Icon: Home, testId: "launcher-dashboard" },
  { href: "/admin", label: "Leads", Icon: Users2, testId: "launcher-leads" },
  { href: "/admin/pipelines", label: "Pipelines", Icon: KanbanSquare, testId: "launcher-pipelines" },
  { href: "/admin/communications", label: "Communications", Icon: Send, testId: "launcher-communications" },
  { href: "/admin/communications", label: "Campaigns", Icon: Megaphone, testId: "launcher-campaigns" },
  { href: "/admin/import", label: "Imports", Icon: Upload, testId: "launcher-imports" },
  { href: "/admin/exports", label: "Exports", Icon: Download, testId: "launcher-exports" },
  { href: "/admin/analytics", label: "Analytics", Icon: BarChart3, testId: "launcher-analytics" },
  { href: "/admin/reports", label: "Reports", Icon: FileBarChart, testId: "launcher-reports" },
  { href: "/admin/subscriptions", label: "Subscriptions", Icon: CreditCard, testId: "launcher-subscriptions" },
  { href: "/admin/support", label: "Customer Support", Icon: LifeBuoy, testId: "launcher-support" },
  { href: "/admin/users", label: "Manage Admins", Icon: Shield, testId: "launcher-users", superOnly: true },
  { href: "/admin/profile", label: "Settings", Icon: Settings, testId: "launcher-settings" },
];

export function WorkspaceLauncher() {
  const { user } = useAdminAuth();
  const [location] = useLocation();
  const visible = ITEMS.filter((i) => !i.superOnly || user?.isSuperadmin);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          data-testid="button-workspace-launcher"
          aria-label="Open workspace menu"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="hidden sm:inline">Workspace</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        data-testid="workspace-launcher-menu"
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          Modules
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="grid grid-cols-2 gap-1 p-1">
          {visible.map((item) => {
            const Icon = item.Icon;
            const active = location === item.href;
            return (
              <DropdownMenuItem
                key={item.testId}
                asChild
                className={
                  "gap-2 cursor-pointer rounded-md " +
                  (active ? "bg-primary/10 text-primary" : "")
                }
              >
                <Link href={item.href} data-testid={item.testId}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate text-sm">{item.label}</span>
                </Link>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
