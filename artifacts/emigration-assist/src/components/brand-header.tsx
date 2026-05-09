import { Link } from "wouter";
import brandLogo from "@assets/E-Migration_Assist_New_Logo-removebg-preview_1778252859401.png";

/**
 * Shared brand header used on every public + admin page.  Renders the
 * combined "E-Migration Assist · Powered by eRide Technologies" wordmark
 * imported via the @assets alias.  The source PNG is black-on-transparent;
 * we re-colour it to white at render time with a `brightness(0) invert(1)`
 * filter so it blends with the dark navy palette across the app.  The
 * logo links back to the public landing page.
 *
 * Variants:
 *   - default: wordmark + tagline (used on landing pages)
 *   - compact: just the wordmark (used on inner / admin pages)
 *
 * Slots:
 *   - leftSlot: rendered immediately to the right of the logo. The admin
 *     dashboard uses this to seat the personalised greeting + live clock +
 *     "Lead Intelligence Dashboard" heading inline with the brand without
 *     polluting public pages.
 *   - rightSlot: rendered at the far right (typically the admin user
 *     dropdown plus operational action buttons on the dashboard).
 */
export function BrandHeader({
  variant = "default",
  rightSlot,
  leftSlot,
}: {
  variant?: "default" | "compact";
  rightSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
}) {
  // Source asset is black on transparent; flip to pure white so it sits
  // cleanly on the dark navy background. `brightness(0)` collapses every
  // non-transparent pixel to black, `invert(1)` then maps black → white
  // while leaving transparency untouched. The drop-shadow gives the thin
  // tagline strokes inside the PNG a contrast halo so they stay legible at
  // small sizes.
  const logoFilter =
    "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.45))";

  return (
    <div
      className="flex items-start justify-between gap-3 sm:gap-6 mb-8"
      data-testid="brand-header"
    >
      <div className="flex items-start gap-3 sm:gap-5 min-w-0 flex-1">
        <Link href="/" className="flex items-center gap-3 group shrink-0">
          <img
            src={brandLogo}
            alt="E-Migration Assist · Powered by eRide Technologies"
            className="h-20 sm:h-24 w-auto transition-opacity group-hover:opacity-90"
            style={{ filter: logoFilter }}
            data-testid="brand-logo"
          />
          {variant === "default" ? (
            <span
              className="hidden sm:inline-flex items-center gap-2 mt-1 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-[11px] sm:text-xs text-primary backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(56,189,248,0.45)]"
              data-testid="brand-header-pill"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(56,189,248,0.9)] animate-pulse"
              />
              <span className="font-medium">Pre-launch immigration assessment</span>
              <span className="text-primary/40">·</span>
              <span className="text-primary/90">Public launch 1 June 2026</span>
            </span>
          ) : null}
        </Link>
        {leftSlot ? (
          <div className="min-w-0 flex-1" data-testid="brand-header-left-slot">
            {leftSlot}
          </div>
        ) : null}
      </div>
      {rightSlot ? (
        <div className="shrink-0 self-center">{rightSlot}</div>
      ) : null}
    </div>
  );
}
