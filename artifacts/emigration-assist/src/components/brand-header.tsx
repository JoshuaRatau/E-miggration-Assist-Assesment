import { Link } from "wouter";

/**
 * Shared brand header used on every public + admin page.  Renders the
 * eRide Technologies logo (sourced from the company asset PDF, served
 * from `/public/eride-logo-light.png`) alongside the product wordmark
 * "E-Migration Assist".  The logo links back to the public landing page.
 *
 * Variants:
 *   - default: full wordmark + tagline (used on landing pages)
 *   - compact: just the logo + product name (used on inner / admin pages)
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
          src="/eride-logo-light.png"
          alt="eRide Technologies"
          className="h-10 w-auto"
          data-testid="brand-logo"
        />
        <div className="flex flex-col leading-tight">
          <span className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">
            eRide Technologies
          </span>
          <span className="font-display font-bold text-lg text-foreground group-hover:text-primary transition-colors">
            E-Migration Assist
          </span>
          {variant === "default" ? (
            <span className="text-xs text-muted-foreground mt-0.5">
              Pre-launch immigration assessment
            </span>
          ) : null}
        </div>
      </Link>
      {rightSlot ? <div>{rightSlot}</div> : null}
    </div>
  );
}
