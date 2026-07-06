// Phase 3 — funnel route context capture.
//
// The landing-page route CTAs carry lightweight URL query context
// (`route`, optional `theme`). On submission we forward whatever is present so
// the server can persist it with the lead. Purely additive attribution
// context — it never changes questionnaire answers, validation, or flow.

export type FunnelContext = { route?: string; theme?: string };

export function readFunnelContext(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): FunnelContext | undefined {
  const params = new URLSearchParams(search);
  const ctx: FunnelContext = {};
  const route = params.get("route");
  const theme = params.get("theme");
  if (route && route.trim()) ctx.route = route.trim();
  if (theme && theme.trim()) ctx.theme = theme.trim();
  return ctx.route || ctx.theme ? ctx : undefined;
}

// Phase 4 — human-friendly labels for surfacing funnel context on the admin
// dashboard. Unknown values fall back to a prettified version of the raw value
// so nothing is ever hidden from internal users.
const ROUTE_LABELS: Record<string, string> = {
  traveller: "Traveller",
  overstay_undesirable: "Overstayed / Undesirable",
  firm_professional: "Firm / Professional",
  continue_reference: "Continue with Reference",
};

const THEME_LABELS: Record<string, string> = {
  stuck_application: "Stuck Application / Visa Anomaly",
};

function prettify(raw: string): string {
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function funnelRouteLabel(route: string): string {
  return ROUTE_LABELS[route] ?? prettify(route);
}

export function funnelThemeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? prettify(theme);
}
