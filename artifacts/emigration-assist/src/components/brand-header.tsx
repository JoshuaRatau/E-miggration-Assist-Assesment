import { Link } from "wouter";
import brandLogo from "@assets/E-Migration_Assist_New_Logo-removebg-preview_1778135270233.png";

/**
 * Shared brand header used on every public + admin page.  Renders the
 * combined "E-Migration Assist · Powered by eRide Technologies" wordmark
 * imported via the @assets alias.  The source PNG is black-on-transparent;
 * we re-colour it to white at render time with `filter: brightness(0)
 * invert(1)` so it blends with the dark navy palette across the app.  The
 * logo links back to the public landing page.
 *
 * Variants:
 *   - default: wordmark + tagline (used on landing pages)
 *   - compact: just the wordmark (used on inner / admin pages)
 */
export function BrandHeader({
  variant = "default",
  rightSlot,
}: {
  variant?: "default" | "compact";
  rightSlot?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 mb-8"
      data-testid="brand-header"
    >
      <Link href="/" className="flex items-center gap-3 group">
        <img
          src={brandLogo}
          alt="E-Migration Assist · Powered by eRide Technologies"
          className="h-20 sm:h-24 w-auto transition-opacity group-hover:opacity-90"
          // Source asset is black on transparent; flip to pure white so it
          // sits cleanly on the dark navy background. `brightness(0)` first
          // collapses every non-transparent pixel to black, `invert(1)`
          // then maps black → white while leaving transparency untouched.
          // The drop-shadow gives the thin tagline strokes inside the PNG a
          // little contrast halo so they stay legible at small sizes.
          style={{
            filter:
              "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
          }}
          data-testid="brand-logo"
        />
        {variant === "default" ? (
          <span className="text-xs text-muted-foreground mt-0.5 hidden sm:inline">
            Pre-launch immigration assessment
          </span>
        ) : null}
      </Link>
      {rightSlot ? <div>{rightSlot}</div> : null}
    </div>
  );
}
