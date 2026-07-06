// Phase 3 — funnel route context.
//
// The public landing page tags each route CTA with lightweight URL query
// context (`route`, optional `theme`). On submission the frontend forwards
// that context and we persist it verbatim into
// prelaunch_leads.funnel_context (jsonb) for downstream analytics,
// classification, and hand-off. This is attribution metadata only — it never
// affects questionnaire logic, scoring, validation, or dispatch.
//
// Values are allow-listed so a tampered / garbage query string cannot pollute
// the column. Anything off-list is dropped; if nothing valid remains we store
// NULL rather than an empty object.

const ALLOWED_ROUTES = new Set([
  "traveller",
  "overstay_undesirable",
  "firm_professional",
  "continue_reference",
]);

const ALLOWED_THEMES = new Set(["stuck_application"]);

export type FunnelContext = { route?: string; theme?: string };

export function sanitizeFunnelContext(v: unknown): FunnelContext | null {
  if (!v || typeof v !== "object") return null;
  const src = v as Record<string, unknown>;
  const out: FunnelContext = {};
  const route = src["route"];
  if (typeof route === "string") {
    const r = route.trim().toLowerCase();
    if (ALLOWED_ROUTES.has(r)) out.route = r;
  }
  const theme = src["theme"];
  if (typeof theme === "string") {
    const t = theme.trim().toLowerCase();
    if (ALLOWED_THEMES.has(t)) out.theme = t;
  }
  return out.route || out.theme ? out : null;
}
