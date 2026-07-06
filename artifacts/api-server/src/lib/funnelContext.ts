// Phase 3 — funnel route context. Phase 10 — lightweight attribution metadata.
//
// The public landing page tags each route CTA with lightweight URL query
// context (`route`, optional `theme`). On submission the frontend forwards
// that context — plus first-touch attribution metadata (landing page, referrer,
// UTM params, device/browser, timestamp) — and we persist it verbatim into
// prelaunch_leads.funnel_context (jsonb) for downstream analytics,
// classification, and hand-off. This is attribution metadata only — it never
// affects questionnaire logic, scoring, validation, or dispatch.
//
// Values are allow-listed / length-capped so a tampered or garbage query string
// cannot pollute the column. Anything off-list is dropped; if nothing valid
// remains we store NULL rather than an empty object.

const ALLOWED_ROUTES = new Set([
  "traveller",
  "overstay_undesirable",
  "firm_professional",
  "continue_reference",
]);

const ALLOWED_THEMES = new Set(["stuck_application"]);

const ALLOWED_DEVICE_TYPES = new Set(["mobile", "tablet", "desktop"]);

export type FunnelContext = {
  route?: string;
  theme?: string;
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

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

// Trim, drop empties, and cap length so a tampered payload can't bloat the
// jsonb column. Returns undefined when nothing usable remains.
function cleanString(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.slice(0, maxLen);
}

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

  // Phase 10 — attribution metadata. Free-form but type-checked + length-capped.
  const landingPage = cleanString(src["landingPage"], 512);
  if (landingPage) out.landingPage = landingPage;
  const referrer = cleanString(src["referrer"], 512);
  if (referrer) out.referrer = referrer;
  for (const key of UTM_KEYS) {
    const val = cleanString(src[key], 256);
    if (val) out[key] = val;
  }
  const deviceType = cleanString(src["deviceType"], 16)?.toLowerCase();
  if (deviceType && ALLOWED_DEVICE_TYPES.has(deviceType))
    out.deviceType = deviceType;
  const browser = cleanString(src["browser"], 32);
  if (browser) out.browser = browser;
  const timestamp = cleanString(src["timestamp"], 40);
  if (timestamp) out.timestamp = timestamp;

  return Object.keys(out).length > 0 ? out : null;
}
