import { z } from "zod";
import { logger } from "./logger";
import {
  getEmaAppUrl,
  getReferralSecret,
  signBody,
} from "./referralTunnel";

/**
 * EMA firm directory — LIVE lookup against the main EMA platform.
 *
 * The main EMA platform is the single source of truth for partner firms.
 * At consent time the funnel fetches the verified-firm directory from
 * `{EMA_APP_URL}/api/public/firms` and matches in-memory. If EMA is
 * unreachable or the tunnel is unconfigured, matching honestly yields
 * NO firm (the referral is still recorded, unmatched) — we never fall
 * back to guessing.
 *
 * PII discipline: matching uses ONLY non-identifying enquiry attributes
 * (matter type + general region). No applicant data leaves the funnel here —
 * the directory fetch is a plain read.
 */

const emaFirmSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  // Comma-separated specialization labels, e.g. "Critical Skills,Business Visas".
  specializations: z.string().nullable().optional(),
  verificationStatus: z.string().nullable().optional(),
  firmType: z.string().nullable().optional(),
});

export interface EmaFirm {
  id: string;
  name: string;
  city: string | null;
  province: string | null;
  specializations: string[];
  firmType: string | null;
}

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetch the verified firm directory from the main EMA platform.
 * Returns `null` (not `[]`) when the directory is UNAVAILABLE — callers must
 * distinguish "EMA down / unconfigured" from "no verified firms exist".
 */
export async function fetchEmaFirms(): Promise<EmaFirm[] | null> {
  const base = getEmaAppUrl();
  if (!base) {
    logger.warn(
      { reason: "ema_app_url_unset" },
      "EMA firm directory unavailable — EMA_APP_URL not configured",
    );
    return null;
  }

  try {
    const res = await fetch(`${base}/api/public/firms`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status },
        "EMA firm directory fetch failed (non-2xx)",
      );
      return null;
    }
    const raw: unknown = await res.json();
    const parsed = z.array(emaFirmSchema).safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues.length },
        "EMA firm directory response did not match expected shape",
      );
      return null;
    }
    return parsed.data
      .filter((f) => (f.verificationStatus ?? "").toLowerCase() === "verified")
      .map((f) => ({
        id: f.id,
        name: f.name,
        city: f.city?.trim() || null,
        province: f.province?.trim() || null,
        specializations: (f.specializations ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        firmType: f.firmType?.trim() || null,
      }));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : "unknown" },
      "EMA firm directory fetch failed",
    );
    return null;
  }
}

export interface EmaMatchCriteria {
  matterType: string;
  region: string;
}

function specialtyMatches(firm: EmaFirm, matterType: string): boolean {
  const matter = matterType.toLowerCase();
  return firm.specializations.some((s) => {
    const spec = s.toLowerCase();
    return matter.includes(spec) || spec.includes(matter) ||
      // Loose token overlap: "Visa application" ↔ "Business Visas".
      spec.split(/\s+/).some((tok) => tok.length > 3 && matter.includes(tok));
  });
}

function regionMatches(firm: EmaFirm, region: string): boolean {
  const r = region.toLowerCase();
  // Firms are all South-African; a country-level region of South Africa
  // matches every firm. Otherwise compare against province/city.
  if (r.includes("south africa")) return true;
  const fields = [firm.province, firm.city].filter(
    (v): v is string => !!v,
  );
  return fields.some(
    (f) => f.toLowerCase().includes(r) || r.includes(f.toLowerCase()),
  );
}

/**
 * Pick the best verified EMA firm for the enquiry.
 * Preference order (mirrors the legacy local matcher):
 *   1. specialty AND region overlap
 *   2. region overlap
 *   3. specialty overlap
 *   4. any verified firm
 */
export function matchEmaFirm(
  criteria: EmaMatchCriteria,
  firms: EmaFirm[],
): EmaFirm | null {
  if (firms.length === 0) return null;

  const both = firms.find(
    (f) =>
      specialtyMatches(f, criteria.matterType) &&
      regionMatches(f, criteria.region),
  );
  if (both) return both;

  const regionOnly = firms.find((f) => regionMatches(f, criteria.region));
  if (regionOnly) return regionOnly;

  const specialtyOnly = firms.find((f) =>
    specialtyMatches(f, criteria.matterType),
  );
  if (specialtyOnly) return specialtyOnly;

  return firms[0] ?? null;
}

// ---------------------------------------------------------------------------
// Firm admin contact lookup (signed, server-to-server)
// ---------------------------------------------------------------------------

/**
 * Every EMA firm has an admin email set at registration; the public firms
 * endpoint deliberately omits it. The funnel requests it via a SIGNED
 * server-to-server call so the offer email can reach the firm admin.
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
