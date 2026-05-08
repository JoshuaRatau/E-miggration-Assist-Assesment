import { type ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth } from "@/lib/adminAuth";
import { AdminUserMenu } from "@/components/admin-user-menu";
import { WorkspaceLauncher } from "@/components/workspace-launcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Home, Send, Upload, Users, Settings, Menu } from "lucide-react";
import brandLogo from "@assets/E-Migration_Assist_New_Logo-removebg-preview_1778135270233.png";

/**
 * Phase 5 Phase B (§1 + §9) — unified admin chrome.
 *
 * Replaces the old per-page `<BrandHeader variant="compact" />` +
 * loose container layout with a persistent left sidebar (desktop) /
 * sheet drawer (mobile) plus a slim sticky topbar that holds the page
 * title and the AdminUserMenu.
 *
 * The dashboard greeting strip + page-specific action buttons stay
 * inside each page's body — the layout is intentionally chrome-only so
 * page hero content (greeting, charts, segment toggle, …) keeps its
 * existing prominence.
 */

type NavItem = {
  href: string;
  label: string;
  testId: string;
  Icon: typeof Home;
  match: (path: string) => boolean;
  superOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Dashboard",
    testId: "sidebar-dashboard",
    Icon: Home,
    // Dashboard owns lead and case detail drill-downs as well — they
    // are sub-views of the lead pipeline, not standalone areas.
    match: (p) =>
      p === "/admin" ||
      p.startsWith("/admin/lead") ||
      p.startsWith("/admin/case"),
  },
  {
    href: "/admin/communications",
    label: "Communications",
    testId: "sidebar-communications",
    Icon: Send,
    // /admin/campaigns/* still resolves (legacy redirects) so we keep
    // it in the active-state predicate to avoid the sidebar momentarily
    // dimming during the redirect hop.
    match: (p) =>
      p.startsWith("/admin/communications") ||
      p.startsWith("/admin/campaigns"),
  },
  {
    href: "/admin/import",
    label: "Imports",
    testId: "sidebar-imports",
    Icon: Upload,
    match: (p) => p.startsWith("/admin/import"),
  },
  {
    href: "/admin/users",
    label: "Manage Admins",
    testId: "sidebar-users",
    Icon: Users,
    match: (p) => p.startsWith("/admin/users"),
    superOnly: true,
  },
  {
    href: "/admin/profile",
    label: "Settings",
    testId: "sidebar-profile",
    Icon: Settings,
    match: (p) => p.startsWith("/admin/profile"),
  },
];

const LOGO_FILTER =
  "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.45))";

function NavList({
  items,
  location,
  onNav,
}: {
  items: NavItem[];
  location: string;
  onNav?: () => void;
}) {
  return (
    <nav
      className="flex flex-col gap-1 p-3"
      aria-label="Admin navigation"
      data-testid="admin-sidebar-nav"
    >
      {items.map((item) => {
        const active = item.match(location);
        const Icon = item.Icon;
        return (
          <Link key={item.href} href={item.href} onClick={onNav}>
            <a
              data-testid={item.testId}
              aria-current={active ? "page" : undefined}
              className={
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors " +
                (active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </a>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminLayout({
  title,
  actions,
  bodyClassName,
  contentClassName,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  /** Override the outer wrapper background (e.g. campaign editor uses a
   *  dark slate gradient). Defaults to `bg-background`. */
  bodyClassName?: string;
  /** Override the main element's padding/width (defaults to a sensible
   *  responsive container). */
  contentClassName?: string;
  children: ReactNode;
}) {
  const { user } = useAdminAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = NAV_ITEMS.filter((n) => !n.superOnly || user?.isSuperadmin);

  return (
    <div
      className={
        "min-h-screen flex " + (bodyClassName ?? "bg-background")
      }
      data-testid="admin-layout"
    >
      {/* Desktop sidebar — fixed 240px, hidden below lg */}
      <aside
        className="hidden lg:flex w-60 shrink-0 flex-col border-r bg-card/40"
        data-testid="admin-sidebar"
      >
        <Link
          href="/admin"
          className="flex items-center gap-2 px-4 py-3 border-b shrink-0"
        >
          <img
            src={brandLogo}
            alt="E-Migration Assist"
            className="h-12 w-auto"
            style={{ filter: LOGO_FILTER }}
            data-testid="admin-sidebar-logo"
          />
        </Link>
        <NavList items={items} location={location} />
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="sticky top-0 z-30 h-14 border-b bg-background/95 backdrop-blur flex items-center gap-3 px-4 sm:px-6"
          data-testid="admin-topbar"
        >
          {/* Mobile drawer trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
                data-testid="button-mobile-nav"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <img
                  src={brandLogo}
                  alt="E-Migration Assist"
                  className="h-10 w-auto"
                  style={{ filter: LOGO_FILTER }}
                />
              </div>
              <NavList
                items={items}
                location={location}
                onNav={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {title ? (
            <h1
              className="text-base sm:text-lg font-semibold truncate flex-1 min-w-0"
              data-testid="admin-page-title"
            >
              {title}
            </h1>
          ) : (
            <div className="flex-1" />
          )}

          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <WorkspaceLauncher />
            <AdminUserMenu />
          </div>
        </header>

        <main
          className={
            contentClassName ??
            "flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px] w-full mx-auto"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
