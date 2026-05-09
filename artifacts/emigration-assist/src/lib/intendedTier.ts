// Phase 6A.5 — Tier-aware lead intent.
//
// Frontend mirror of the server-side allow-list in
// `artifacts/api-server/src/routes/adminLeads.ts → INTENDED_TIER_VALUES`.
// Server is the source of truth — keep this list in sync with the server
// list, the schema column comment in `lib/db/src/schema/leads.ts`, and the
// description on the OpenAPI Lead schema. The 11 values map to the SaaS
// pricing ladder in `attached_assets/E-Migration_Assist_–_Pricing_*.pdf`.

export const INTENDED_TIER_VALUES = [
  "free",
  "basic",
  "plus",
  "pro",
  "premium",
  "starter_firm",
  "growth_firm",
  "scale_firm",
  "enterprise",
  "concierge",
  "unknown",
] as const;

export type IntendedTier = (typeof INTENDED_TIER_VALUES)[number];

// Acquisition motion the tier belongs to. Drives downstream behaviour:
// `self_serve` tiers route to Stripe checkout (Phase 6C); `firm` tiers
// run a 14-day pilot trial; `concierge` is white-glove sales-led.
export type TierMotion = "self_serve" | "firm" | "concierge" | "unknown";

export const TIER_MOTION: Record<IntendedTier, TierMotion> = {
  free: "self_serve",
  basic: "self_serve",
  plus: "self_serve",
  pro: "self_serve",
  premium: "self_serve",
  starter_firm: "firm",
  growth_firm: "firm",
  scale_firm: "firm",
  enterprise: "firm",
  concierge: "concierge",
  unknown: "unknown",
};

export const TIER_LABEL: Record<IntendedTier, string> = {
  free: "Free",
  basic: "Basic",
  plus: "Plus",
  pro: "Pro",
  premium: "Premium",
  starter_firm: "Starter (Firm)",
  growth_firm: "Growth (Firm)",
  scale_firm: "Scale (Firm)",
  enterprise: "Enterprise",
  concierge: "Concierge",
  unknown: "Unknown",
};

// Compact pill colour per motion. Tailwind utility strings — kept as
// literals so the JIT compiler picks them up. Self-serve tiers go cool
// (slate / sky) so they don't compete visually with the priority badge;
// firm tiers go indigo; concierge gets a warm accent because it's the
// highest-value motion and operators should notice it on the row.
export const TIER_BADGE_CLASS: Record<IntendedTier, string> = {
  free: "border-slate-300 bg-slate-50 text-slate-700",
  basic: "border-sky-200 bg-sky-50 text-sky-700",
  plus: "border-sky-300 bg-sky-100 text-sky-800",
  pro: "border-sky-400 bg-sky-100 text-sky-900",
  premium: "border-violet-300 bg-violet-50 text-violet-800",
  starter_firm: "border-indigo-200 bg-indigo-50 text-indigo-700",
  growth_firm: "border-indigo-300 bg-indigo-100 text-indigo-800",
  scale_firm: "border-indigo-400 bg-indigo-100 text-indigo-900",
  enterprise: "border-purple-400 bg-purple-100 text-purple-900",
  concierge: "border-amber-300 bg-amber-50 text-amber-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-500",
};

export function isIntendedTier(v: unknown): v is IntendedTier {
  return (
    typeof v === "string" &&
    (INTENDED_TIER_VALUES as readonly string[]).includes(v)
  );
}

export function tierLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return isIntendedTier(v) ? TIER_LABEL[v] : v;
}

export function tierBadgeClass(v: string | null | undefined): string {
  if (!v || !isIntendedTier(v))
    return "border-slate-200 bg-slate-50 text-slate-400";
  return TIER_BADGE_CLASS[v];
}
