// Phase 3 — funnel route context capture.
//
// The landing-page route CTAs carry lightweight URL query context
// (`route`, optional `theme`). On submission we forward whatever is present so
// the server can persist it with the lead. Purely additive attribution
// context — it never changes questionnaire answers, validation, or flow.

// Phase 10 — lightweight lead attribution / intelligence. Captured first-touch
// on landing and merged into funnel_context at submission. Pure metadata — it
// never drives questionnaire logic, validation, scoring, or dispatch.
export type FunnelAttribution = {
  landingPage?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  deviceType?: string;
  browser?: string;
  timestamp?: string;
};

export type FunnelContext = { route?: string; theme?: string } & FunnelAttribution;

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

// ── Phase 10 — first-touch attribution capture ────────────────────────────────
//
// UTM params + referrer live on the entry (landing) page, but the route CTAs
// navigate to param-free destinations, so by submission time that context is
// gone. We therefore snapshot it on the first page load of the session and read
// it back when the lead is submitted. Best-effort + no-op-safe: any failure
// (private mode, no sessionStorage) is swallowed so submission is never blocked.

const ATTRIBUTION_STORAGE_KEY = "ema_funnel_attribution";

function detectDeviceType(ua: string): string {
  if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)))
    return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return "Safari";
  return "Other";
}

/**
 * Capture first-touch attribution into sessionStorage. Idempotent per session:
 * only the FIRST call writes, so later in-app navigations never overwrite the
 * original landing context. Call once, as early as possible, on app mount.
 */
export function captureFunnelAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const ua = window.navigator?.userAgent ?? "";
    const raw: FunnelAttribution = {
      landingPage: window.location.pathname + window.location.search,
      referrer: document.referrer || undefined,
      utm_source: params.get("utm_source") ?? undefined,
      utm_medium: params.get("utm_medium") ?? undefined,
      utm_campaign: params.get("utm_campaign") ?? undefined,
      utm_content: params.get("utm_content") ?? undefined,
      utm_term: params.get("utm_term") ?? undefined,
      deviceType: detectDeviceType(ua),
      browser: detectBrowser(ua),
      timestamp: new Date().toISOString(),
    };
    const cleaned: FunnelAttribution = {};
    (Object.keys(raw) as (keyof FunnelAttribution)[]).forEach((k) => {
      const val = raw[k];
      if (typeof val === "string" && val.trim()) cleaned[k] = val.trim();
    });
    window.sessionStorage.setItem(
      ATTRIBUTION_STORAGE_KEY,
      JSON.stringify(cleaned),
    );
  } catch {
    // sessionStorage unavailable — attribution is best-effort only.
  }
}

/** Read back the first-touch attribution snapshot (empty object if none). */
export function readFunnelAttribution(): FunnelAttribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const src = parsed as Record<string, unknown>;
    const out: FunnelAttribution = {};
    (ATTRIBUTION_KEYS as readonly (keyof FunnelAttribution)[]).forEach((k) => {
      const val = src[k];
      if (typeof val === "string" && val.trim()) out[k] = val.trim();
    });
    return out;
  } catch {
    return {};
  }
}

const ATTRIBUTION_KEYS = [
  "landingPage",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "deviceType",
  "browser",
  "timestamp",
] as const;

/**
 * Build the funnel_context sent at submission: route/theme from the CURRENT URL
 * merged with the first-touch attribution. Route/theme always win over any
 * same-named attribution key (there are none today, but the order keeps the
 * "extend without overwriting existing values" invariant explicit). Returns
 * undefined when nothing is available so the request body omits the field —
 * keeping the submission contract unchanged.
 */
export function buildSubmissionFunnelContext(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): FunnelContext | undefined {
  const routeTheme = readFunnelContext(search) ?? {};
  const attribution = readFunnelAttribution();
  const merged: FunnelContext = { ...attribution, ...routeTheme };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
