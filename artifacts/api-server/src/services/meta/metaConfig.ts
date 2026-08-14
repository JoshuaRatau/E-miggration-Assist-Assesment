import crypto from "node:crypto";

// Central Meta integration configuration. All env access for the Meta
// module goes through here — no scattered process.env reads.
//
// Required for OAuth:  META_APP_ID, META_APP_SECRET
// Optional:            META_GRAPH_API_VERSION (default below)
//                      META_REDIRECT_URI (else derived from request/host)
//                      META_WEBHOOK_VERIFY_TOKEN (webhook subscription)

export const DEFAULT_GRAPH_VERSION = "v23.0";

export function metaAppId(): string | null {
  return process.env.META_APP_ID?.trim() || null;
}

export function metaAppSecret(): string | null {
  return process.env.META_APP_SECRET?.trim() || null;
}

export function graphVersion(): string {
  return process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
}

export function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

export function webhookVerifyToken(): string | null {
  return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null;
}

export function isConfigured(): boolean {
  return Boolean(metaAppId() && metaAppSecret());
}

/**
 * OAuth redirect URI. Meta requires an exact, pre-registered HTTPS URL.
 * Priority: explicit META_REDIRECT_URI → PUBLIC_BASE_URL → REPLIT_DOMAINS
 * (production) → REPLIT_DEV_DOMAIN (dev). The path is fixed.
 */
export function redirectUri(): string | null {
  const explicit = process.env.META_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base =
    process.env.PUBLIC_BASE_URL?.trim() ||
    (process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : null);
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/meta/auth/callback`;
}

/**
 * Public webhook callback URL that Meta will call. Must be the DEPLOYED
 * host (Meta verifies it with a GET before accepting the subscription).
 * Priority: explicit META_WEBHOOK_CALLBACK_URL → same base derivation as
 * the OAuth redirect. The path is fixed.
 */
export function webhookCallbackUrl(): string | null {
  const explicit = process.env.META_WEBHOOK_CALLBACK_URL?.trim();
  if (explicit) return explicit;
  const redirect = redirectUri();
  if (!redirect) return null;
  return redirect.replace(/\/api\/meta\/auth\/callback$/, "/api/meta/webhook");
}

/** Frontend URL to land on after OAuth (success or failure). */
export function frontendReturnUrl(): string {
  const origin = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  if (origin) return `${origin.replace(/\/$/, "")}/admin/meta-analytics`;
  return "/admin/meta-analytics";
}

// ---------------------------------------------------------------------------
// Token encryption — AES-256-GCM keyed off SESSION_SECRET. Tokens are
// opaque to the DB and to backups. Format: base64(iv).base64(tag).base64(ct)

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required for Meta token storage");
  return crypto.createHash("sha256").update(`${secret}:meta-token-v1`).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed encrypted token");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ---------------------------------------------------------------------------
// OAuth state — HMAC-signed nonce+timestamp, validated on callback.
// Stateless (no session storage needed) with a 15-minute validity window.

const STATE_TTL_MS = 15 * 60 * 1000;

function stateKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required for Meta OAuth state");
  return crypto.createHash("sha256").update(`${secret}:meta-oauth-state`).digest();
}

export function createOauthState(): string {
  const payload = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
  const sig = crypto.createHmac("sha256", stateKey()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function validateOauthState(state: string | undefined): boolean {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const payload = `${ts}.${nonce}`;
  const expected = crypto
    .createHmac("sha256", stateKey())
    .update(payload)
    .digest("hex");
  const sigBuf = Buffer.from(sig ?? "", "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= STATE_TTL_MS;
}
