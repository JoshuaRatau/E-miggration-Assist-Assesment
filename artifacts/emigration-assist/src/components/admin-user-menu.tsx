import { Link, useLocation } from "wouter";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Home,
  Users2,
  KanbanSquare,
  Send,
  Megaphone,
  Upload,
  Download,
  Share2,
  BarChart3,
  FileBarChart,
  CreditCard,
  LifeBuoy,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";

/**
 * Phase 5G — single unified Admin dropdown.
 *
 * Replaces the previous sidebar + AdminUserMenu + WorkspaceLauncher
 * trio. The left rail is gone in chrome v3; this is now the SOLE
 * navigation surface (excluding logo → dashboard, which is a fast-path
 * exit).
 *
 * Trigger label: "Admin" (intentionally generic — the brief specifies
 * the rebrand from "Demo Admin" to "Admin"). Identity is preserved
 * inside the menu via the header label rows so operators can still see
 * which account they're signed in as.
 *
 * Item order is grouped, not alphabetical: Workspace (operational
 * dailies), Operations (transactional modules), Intelligence
 * (analytics-leaning), Admin (account-level), then Logout. Same 12
 * modules previously surfaced in WorkspaceLauncher plus the explicit
 * Logout the brief calls out.
 */

type Item = {
  href: string;
  label: string;
  Icon: typeof Home;
  testId: string;
  superOnly?: boolean;
};

const WORKSPACE: Item[] = [
  { href: "/admin", label: "Dashboard", Icon: Home, testId: "menu-dashboard" },
  { href: "/admin", label: "Leads", Icon: Users2, testId: "menu-leads" },
  { href: "/admin/pipelines", label: "Pipelines", Icon: KanbanSquare, testId: "menu-pipelines" },
];

const OPERATIONS: Item[] = [
  { href: "/admin/communications", label: "Communications", Icon: Send, testId: "menu-communications" },
  { href: "/admin/communications", label: "Campaigns", Icon: Megaphone, testId: "menu-campaigns" },
  { href: "/admin/import", label: "Imports", Icon: Upload, testId: "menu-imports" },
  { href: "/admin/exports", label: "Exports", Icon: Download, testId: "menu-exports" },
  { href: "/admin/referrals", label: "Referral Tunnel", Icon: Share2, testId: "menu-referrals" },
];

const INTELLIGENCE: Item[] = [
  { href: "/admin/analytics", label: "Analytics", Icon: BarChart3, testId: "menu-analytics" },
  { href: "/admin/reports", label: "Reports", Icon: FileBarChart, testId: "menu-reports" },
  { href: "/admin/subscriptions", label: "Subscription Management", Icon: CreditCard, testId: "menu-subscriptions" },
  { href: "/admin/support", label: "Customer Support", Icon: LifeBuoy, testId: "menu-support" },
];

const ACCOUNT: Item[] = [
  { href: "/admin/users", label: "Manage Admins", Icon: Shield, testId: "menu-users", superOnly: true },
  { href: "/admin/profile", label: "Settings", Icon: Settings, testId: "menu-settings" },
];

function MenuRow({
  item,
  active,
}: {
  item: Item;
  active: boolean;
}) {
  const Icon = item.Icon;
  return (
    <DropdownMenuItem asChild className="cursor-pointer">
      <Link
        href={item.href}
        data-testid={item.testId}
        className={
          "flex items-center gap-3 px-2 py-2 rounded-md text-sm " +
          (active ? "bg-primary/10 text-primary" : "")
        }
      >
        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
      </Link>
    </DropdownMenuItem>
  );
}

export function AdminUserMenu() {
  const { user, logout } = useAdminAuth();
  const [location] = useLocation();
  if (!user) return null;

  const groups: Array<{ label: string; items: Item[] }> = [
    { label: "Workspace", items: WORKSPACE },
    { label: "Operations", items: OPERATIONS },
    { label: "Intelligence", items: INTELLIGENCE },
    {
      label: "Admin",
      items: ACCOUNT.filter((i) => !i.superOnly || user.isSuperadmin),
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 h-10 px-3 bg-white/5 hover:bg-white/10 border-white/15 text-white"
          data-testid="button-admin-menu"
          aria-label="Open admin menu"
        >
          <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            A
          </span>
          <span className="hidden sm:inline font-medium">Admin</span>
          <ChevronDown className="h-4 w-4 opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-72 p-2"
        data-testid="admin-menu"
      >
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex flex-col">
            <span className="text-sm font-semibold truncate">
              {user.displayName ?? "Admin"}
              {user.isSuperadmin ? (
                <span className="ml-2 text-[10px] uppercase tracking-wide font-medium text-primary">
                  Superadmin
                </span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((group, idx) => (
          <div key={group.label}>
            <DropdownMenuLabel className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {group.label}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <MenuRow
                key={item.testId}
                item={item}
                active={location === item.href}
              />
            ))}
            {idx < groups.length - 1 ? <DropdownMenuSeparator /> : null}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void logout();
          }}
          data-testid="menu-logout"
          className="cursor-pointer text-destructive focus:text-destructive gap-3 px-2 py-2"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
