import { type ReactNode } from "react";
import { Link } from "wouter";
import { AdminUserMenu } from "@/components/admin-user-menu";
import brandLogo from "@assets/E-Migration_Assist_New_Logo-removebg-preview_1778135270233.png";

/**
 * Phase 5G chrome v3 — sidebarless layout.
 *
 * Reverses the Phase 5F sidebar+launcher hybrid and consolidates ALL
 * navigation into the top-right Admin dropdown (`AdminUserMenu`). The
 * left rail is gone entirely; the dashboard now spans the full content
 * width to feel less compressed.
 *
 * Layout regions (top to bottom):
 *   1. Tall topbar (h-20 desktop / h-16 mobile) — large clickable
 *      brand logo on the left, optional page title in the centre,
 *      page-level `actions` slot + Admin dropdown on the right.
 *   2. Main column — wide responsive container, generous top padding so
 *      the page heading sits lower and breathes.
 *
 * The body uses a layered dark-blue gradient anchored on the #3381C7
 * brand accent (recommended interpretation of the brief — the literal
 * flat #3381C7 page background was rejected as visually heavy).
 * Cards/components retain their existing `bg-card` so they sit
 * elevated on this gradient.
 *
 * Per-page overrides:
 *   - `bodyClassName` swaps the body gradient (campaign editor/detail
 *     keep their own `bg-slate-950`).
 *   - `contentClassName` swaps main padding/width.
 */

const BRAND_GRADIENT =
  "bg-[radial-gradient(ellipse_at_top,_#173768_0%,_#0c1d3a_55%,_#0a162b_100%)]";

const LOGO_FILTER =
  "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.45))";

export function AdminLayout({
  title,
  actions,
  bodyClassName,
  contentClassName,
  children,
}: {
  title?: string;
  /** Page-level action slot rendered to the LEFT of the Admin dropdown.
   *  Most pages should leave this empty — global modules live in the
   *  dropdown. Reserved for genuinely page-scoped controls (e.g. "New
   *  campaign" on the campaigns list). */
  actions?: ReactNode;
  bodyClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "min-h-screen flex flex-col text-foreground " +
        (bodyClassName ?? BRAND_GRADIENT)
      }
      data-testid="admin-layout"
    >
      <header
        className="sticky top-0 z-30 h-16 sm:h-20 border-b border-white/10 bg-slate-950/60 backdrop-blur supports-[backdrop-filter]:bg-slate-950/40 flex items-center gap-3 px-4 sm:px-8"
        data-testid="admin-topbar"
      >
        <Link
          href="/admin"
          className="flex items-center gap-3 shrink-0 -my-1 group"
          data-testid="link-brand-home"
          aria-label="Go to Dashboard"
        >
          <img
            src={brandLogo}
            alt="E-Migration Assist"
            className="h-12 sm:h-16 w-auto transition-transform group-hover:scale-[1.02]"
            style={{ filter: LOGO_FILTER }}
            data-testid="admin-brand-logo"
          />
        </Link>

        {title ? (
          <h1
            className="hidden md:block text-sm font-medium text-white/70 truncate flex-1 min-w-0 pl-4 ml-2 border-l border-white/10"
            data-testid="admin-page-title"
          >
            {title}
          </h1>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {actions}
          <AdminUserMenu />
        </div>
      </header>

      <main
        className={
          contentClassName ??
          "flex-1 px-4 sm:px-8 lg:px-12 pt-10 pb-12 max-w-[1600px] w-full mx-auto"
        }
      >
        {children}
      </main>
    </div>
  );
}
