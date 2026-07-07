import crypto from "node:crypto";

/**
 * EMA Referral Tunnel — shared contract primitives (SENDER side).
 *
 * This project is the EMA Leads Funnel (the sender). It talks to the separate
 * main EMA operating system (the receiver) ONLY over HTTP, signing every
 * message with `REFERRAL_TUNNEL_SECRET` (HMAC-SHA256, base64url).
 *
 * The functions below are byte-exact reproductions of the contract so that
 * signatures produced here verify on EMA and vice-versa. Do NOT change the
 * serialization without changing EMA in lockstep — any drift makes every
 * signature fail.
 *
 * Two serializations are used ON PURPOSE:
 *   - Redirect token body  → base64url(JSON.stringify(payload))   (see signReferralToken)
 *   - Server-to-server body → stableStringify(body) (recursive key-sort)
 */

/** base64url-encode a Buffer (base64 with +→-, /→_, trailing = stripped). */
export function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** HMAC-SHA256 over a string, output base64url. */
export function hmac(data: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(data).digest());
}

/**
 * Deterministic JSON: recursively sort object keys so both systems produce
 * IDENTICAL bytes regardless of key insertion order. Used for the S2S bodies.
 * Values must never be `undefined` (use `null`) or the output is invalid JSON.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

// ---------------------------------------------------------------------------
// Configuration — fail closed when the secret is missing.
// ---------------------------------------------------------------------------

/** Shared HMAC secret. `null` when unset ⇒ the tunnel must not sign/send. */
export function getReferralSecret(): string | null {
  const s = process.env["REFERRAL_TUNNEL_SECRET"]?.trim();
  return s && s.length > 0 ? s : null;
}

/** Base URL of the main EMA app (no trailing slash). `null` when unset. */
export function getEmaAppUrl(): string | null {
  const u = process.env["EMA_APP_URL"]?.trim().replace(/\/+$/, "");
  return u && u.length > 0 ? u : null;
}

/** True only when both the secret and the EMA URL are configured. */
export function isTunnelConfigured(): boolean {
  return getReferralSecret() !== null && getEmaAppUrl() !== null;
}

// ---------------------------------------------------------------------------
// 3.1 Redirect token (funnel → firm browser → EMA)
// ---------------------------------------------------------------------------

export const INTENDED_ACTION = "accept_referral_open_ema" as const;

export interface ReferralTokenPayload {
  referralId: string;
  assignmentId?: string;
  funnelFirmId?: string;
  intendedAction: typeof INTENDED_ACTION;
  /** epoch MILLISECONDS */
  issuedAt: number;
  /** epoch MILLISECONDS — keep short (e.g. now + 30 min) */
  expiresAt: number;
  nonce: string;
}

/**
 * Sign a redirect token. Result is `"<body>.<sig>"` where
 * `body = base64url(utf8(JSON.stringify(payload)))` and `sig` is the HMAC
 * over the base64url `body` STRING (not the raw JSON).
 */
export function signReferralToken(
  payload: ReferralTokenPayload,
  secret: string,
): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${hmac(body, secret)}`;
}

// ---------------------------------------------------------------------------
// 3.2 / 3.3 Server-to-server body signing + verification
// ---------------------------------------------------------------------------

/** Sign an S2S body: HMAC over `stableStringify(body)`. */
export function signBody(body: unknown, secret: string): string {
  return hmac(stableStringify(body), secret);
}

// ---------------------------------------------------------------------------
// EMA route-aware referral metadata (SENDER → EMA applicant push body, §3.2)
// ---------------------------------------------------------------------------

/**
 * Funnel payload contract version stamped onto every applicant push body so EMA
 * can tell which sender-side metadata contract produced the message. Bump this
 * (in lockstep with EMA) whenever the shape of the route-aware metadata changes.
 */
export const FUNNEL_PAYLOAD_VERSION = "1" as const;

/**
 * The route vocabulary EMA accepts on the referral push body. The funnel's own
 * funnel-context routes map onto these: three are identical and the funnel's
 * `continue_reference` corresponds to EMA's `reference_resume`.
 */
export type EmaReferralRoute =
  | "traveller"
  | "overstay_undesirable"
  | "firm_professional"
  | "reference_resume";

const EMA_REFERRAL_ROUTES = new Set<EmaReferralRoute>([
  "traveller",
  "overstay_undesirable",
  "firm_professional",
  "reference_resume",
]);

// Funnel-context route values that are not identical to an EMA route but map
// onto one. Kept separate from the identity set so the mapping is explicit.
const FUNNEL_ROUTE_ALIASES: Record<string, EmaReferralRoute> = {
  continue_reference: "reference_resume",
};

/**
 * Translate a funnel-context route into EMA's route vocabulary. Returns the
 * matching EMA route, or `null` when the input is missing or not recognised —
 * callers MUST omit the `route` field entirely rather than send an unknown
 * value, so an invalid route is never sent.
 */
export function toEmaReferralRoute(
  route: string | null | undefined,
): EmaReferralRoute | null {
  if (typeof route !== "string") return null;
  const r = route.trim().toLowerCase();
  if (!r) return null;
  if (EMA_REFERRAL_ROUTES.has(r as EmaReferralRoute)) {
    return r as EmaReferralRoute;
  }
  return FUNNEL_ROUTE_ALIASES[r] ?? null;
}

/**
 * Verify an incoming S2S signature. Fails closed when the secret or the
 * signature is missing. Uses a constant-time comparison.
 *
 * @param rawStableBody result of `stableStringify(req.body)`
 */
export function verifyBodySignature(
  rawStableBody: string,
  signature: string | null | undefined,
  secret: string | null,
): boolean {
  if (!secret || !signature) return false; // fail closed
  const expected = hmac(rawStableBody, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
