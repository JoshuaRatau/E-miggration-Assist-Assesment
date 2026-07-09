import { z } from "zod";
import { logger } from "./logger";
import {
  getEmaAppUrl,
  getReferralSecret,
  signBody,
} from "./referralTunnel";

/**
 * EMA firm matching — the MAIN EMA platform is the single source of truth
 * for active, vetted firms, regions, specialties, and capacity.
 *
 * The funnel performs NO local firm matching. At consent time it sends a
 * signed, NON-PII match request to `POST {EMA_APP_URL}/api/referrals/match`
 * and EMA decides the firm. If EMA is unreachable, unconfigured, or returns
 * no match, the referral is honestly recorded UNMATCHED — we never fall back
 * to guessing or local data.
 *
 * PII discipline: the match request carries ONLY non-identifying enquiry
 * attributes (lead reference, matter type, region, urgency, route, theme).
 * No applicant name/email/phone leaves the funnel at matching stage.
 */

const FETCH_TIMEOUT_MS = 5_000;

/** Non-PII match request sent to Main EMA. */
export interface EmaMatchRequest {
  leadReference: string;
  matterType: string;
  region: string;
  urgency: string;
  route?: string;
  theme?: string;
}

/**
 * EMA's live response uses `firmDisplayName` + a structured `preview` object;
 * the documented contract said `firmName` + `redactedPreview` string. Accept
 * BOTH shapes (live-observed shape takes precedence when both present).
 */
const emaPreviewObjectSchema = z
  .object({
    displayName: z.string().optional(),
    region: z.string().optional(),
    specialties: z.string().optional(),
    verified: z.boolean().optional(),
  })
  .passthrough();

const emaMatchResponseSchema = z.object({
  matched: z.boolean(),
  firmId: z.string().min(1).nullable().optional(),
  firmName: z.string().min(1).nullable().optional(),
  firmDisplayName: z.string().min(1).nullable().optional(),
  redactedPreview: z.string().nullable().optional(),
  preview: emaPreviewObjectSchema.nullable().optional(),
  matchTier: z.string().nullable().optional(),
  // REQUIRED on matched:true (enforced below) — the offer email must carry
  // EMA's signed accept URL, never a funnel-minted fallback.
  acceptUrl: z.string().url().nullable().optional(),
  // Optional firm-admin contact for the offer email; EMA may omit it, in
  // which case the funnel falls back to the signed contact lookup below.
  firmContactEmail: z.string().email().nullable().optional(),
});

export interface EmaFirmMatch {
  firmId: string;
  firmName: string;
  redactedPreview: string | null;
  matchTier: string | null;
  /** Signed, expiring accept URL minted by EMA — always present on a match. */
  acceptUrl: string;
  firmContactEmail: string | null;
}

export type EmaMatchOutcome =
  | { kind: "matched"; match: EmaFirmMatch }
  | { kind: "no_match" }
  | { kind: "unavailable" };

/**
 * Ask Main EMA to match a firm for this enquiry.
 *
 * `POST {EMA_APP_URL}/api/referrals/match` with the standard S2S signing
 * convention: `x-referral-signature` = HMAC-SHA256 over `stableStringify(body)`
 * using `REFERRAL_TUNNEL_SECRET`.
 *
 * Never throws. `unavailable` = EMA down/unconfigured/unexpected response;
 * `no_match` = EMA answered but has no available firm.
 */
export async function requestEmaFirmMatch(
  request: EmaMatchRequest,
): Promise<EmaMatchOutcome> {
  const base = getEmaAppUrl();
  const secret = getReferralSecret();
  if (!base || !secret) {
    logger.warn(
      { reason: !base ? "ema_app_url_unset" : "tunnel_secret_unset" },
      "EMA firm matching unavailable — tunnel not configured",
    );
    return { kind: "unavailable" };
  }

  // Build the body with keys present ONLY when a value exists — the HMAC
  // covers the exact serialized body, so absent keys must be omitted, never
  // set to undefined/null.
  const body: Record<string, string> = {
    leadReference: request.leadReference,
    matterType: request.matterType,
    region: request.region,
    urgency: request.urgency,
  };
  if (request.route) body.route = request.route;
  if (request.theme) body.theme = request.theme;

  try {
    const res = await fetch(`${base}/api/referrals/match`, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-referral-signature": signBody(body, secret),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // A 404 body-level "no match" should come back as 200 {matched:false};
      // any non-2xx means the endpoint failed or does not exist yet.
      logger.warn(
        { status: res.status },
        "EMA firm match call failed (non-2xx)",
      );
      return { kind: "unavailable" };
    }
    const raw: unknown = await res.json();
    const parsed = emaMatchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues.length },
        "EMA firm match response did not match expected shape",
      );
      return { kind: "unavailable" };
    }
    const data = parsed.data;
    if (!data.matched) {
      return { kind: "no_match" };
    }
    const firmName = data.firmDisplayName ?? data.firmName ?? null;
    // Prefer an explicit redactedPreview string; otherwise render EMA's
    // structured preview object into safe display lines (all non-PII).
    const redactedPreview =
      data.redactedPreview ??
      (data.preview
        ? [
            data.preview.displayName ? `Firm: ${data.preview.displayName}` : null,
            data.preview.region ? `Region: ${data.preview.region}` : null,
            data.preview.specialties
              ? `Specialties: ${data.preview.specialties}`
              : null,
            data.preview.verified ? `Verified partner firm` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : null) ??
      null;
    if (!data.firmId || !firmName || !data.acceptUrl) {
      // A matched response MUST carry the firm identity AND the signed
      // accept URL — anything less is a malformed/incomplete EMA response.
      // Treat as unavailable (never send an offer email without a signed
      // accept URL).
      logger.warn(
        {
          hasFirmId: Boolean(data.firmId),
          hasFirmName: Boolean(firmName),
          hasAcceptUrl: Boolean(data.acceptUrl),
        },
        "EMA match response marked matched but missing required fields",
      );
      return { kind: "unavailable" };
    }
    return {
      kind: "matched",
      match: {
        firmId: data.firmId,
        firmName,
        redactedPreview,
        matchTier: data.matchTier ?? null,
        acceptUrl: data.acceptUrl,
        firmContactEmail: data.firmContactEmail ?? null,
      },
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : "unknown" },
      "EMA firm match call failed",
    );
    return { kind: "unavailable" };
  }
}

// ---------------------------------------------------------------------------
// Firm admin contact lookup (signed, server-to-server) — FALLBACK only, used
// when the match response does not include `firmContactEmail`.
// ---------------------------------------------------------------------------

/**
 * Every EMA firm has an admin email set at registration. The funnel requests
 * it via a SIGNED server-to-server call so the offer email can reach the
 * firm admin.
 *
 * Expected EMA-side endpoint (documented in
 * docs/recommended-fix-or-clarification.md):
 *   GET {EMA_APP_URL}/api/referral-tunnel/firms/:firmId/contact
 *   Headers: x-funnel-timestamp, x-funnel-signature
 *     (HMAC-SHA256 over the key-sorted JSON of `{"firmId": "...", "timestamp": "..."}`
 *      — same signing primitive as the applicant push.)
 *   200 → { "adminEmail": "admin@firm.example" }
 *
 * Returns null (never throws) when the endpoint is missing/unreachable —
 * callers must audit the skipped notification instead of failing consent.
 */
export async function fetchEmaFirmAdminEmail(
  firmId: string,
): Promise<string | null> {
  const base = getEmaAppUrl();
  const secret = getReferralSecret();
  if (!base || !secret) return null;

  try {
    const timestamp = Date.now().toString();
    const signature = signBody({ firmId, timestamp }, secret);

    const res = await fetch(
      `${base}/api/referral-tunnel/firms/${encodeURIComponent(firmId)}/contact`,
      {
        method: "GET",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: "application/json",
          "x-funnel-timestamp": timestamp,
          "x-funnel-signature": signature,
        },
      },
    );
    if (!res.ok) {
      logger.warn(
        { status: res.status, firmId },
        "EMA firm admin-contact lookup failed (endpoint missing or rejected)",
      );
      return null;
    }
    const raw: unknown = await res.json();
    const parsed = z
      .object({ adminEmail: z.string().email() })
      .safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data.adminEmail;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : "unknown", firmId },
      "EMA firm admin-contact lookup failed",
    );
    return null;
  }
}
