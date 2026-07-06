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
