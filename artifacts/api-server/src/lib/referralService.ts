import crypto from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  partnerFirmsTable,
  type PartnerFirm,
  type PrelaunchLead,
} from "@workspace/db";
import { logger } from "./logger";
import {
  INTENDED_ACTION,
  getEmaAppUrl,
  getReferralSecret,
  signBody,
  signReferralToken,
  stableStringify,
  type ReferralTokenPayload,
} from "./referralTunnel";

/**
 * SENDER-side referral service — matching, redacted-preview derivation, the
 * signed applicant push (§3.2) and the signed redirect token (§3.1).
 *
 * PII discipline: only `buildApplicantObject()` (fed straight into the signed
 * push body) ever reads identifying fields off the lead. Every other export
 * returns non-identifying data only.
 */

// Token lifetime — short-lived per the contract (§3.1 suggests ~30 min).
export const REFERRAL_TOKEN_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Redacted preview (NON-IDENTIFYING ONLY)
// ---------------------------------------------------------------------------

export interface ReferralPreview {
  matterType: string;
  urgency: string;
  region: string;
  summary: string;
}

const MATTER_TYPE_LABELS: Record<string, string> = {
  visa_inquiry: "Visa application",
  overstay_appeal: "Overstay / appeal",
  travel_entry_assistance: "Travel & entry assistance",
};

const URGENCY_BY_PRIORITY: Record<string, string> = {
  critical: "urgent",
  high: "high",
  medium: "standard",
  low: "low",
};

/**
 * Derive a redacted preview from a lead. Uses ONLY non-identifying fields:
 * enquiry category, urgency (from priority), and general region (country of
 * residence). Never includes name, email, phone, nationality, passport, or
 * free-text situation notes that could identify the applicant.
 */
export function deriveReferralPreview(lead: PrelaunchLead): ReferralPreview {
  const matterType =
    (lead.inquiryType && MATTER_TYPE_LABELS[lead.inquiryType]) ||
    (lead.leadType === "professional"
      ? "Professional / firm enquiry"
      : "Immigration enquiry");

  const urgency =
    (lead.leadPriority && URGENCY_BY_PRIORITY[lead.leadPriority]) || "standard";

  // General region only — country level, never a street/city precise address.
  const region = lead.countryOfResidence?.trim() || "Not specified";

  const summary = `${matterType} — ${urgency} priority. Applicant located in ${region}. Full details available in EMA once the conflict check passes.`;

  return { matterType, urgency, region, summary };
}

// ---------------------------------------------------------------------------
// Partner matching (no PII involved)
// ---------------------------------------------------------------------------

export interface MatchCriteria {
  matterType: string;
  region: string;
}

/**
 * Match a referral to a vetted, active partner firm with remaining capacity.
 * Preference order:
 *   1. specialty (matterType) AND region overlap
 *   2. region overlap
 *   3. any vetted+active+capacity firm
 * Matching uses only non-identifying enquiry attributes.
 */
export async function matchPartnerFirm(
  criteria: MatchCriteria,
): Promise<PartnerFirm | null> {
  const eligible = await db
    .select()
    .from(partnerFirmsTable)
    .where(
      and(
        eq(partnerFirmsTable.active, true),
        eq(partnerFirmsTable.vettingStatus, "vetted"),
        or(
          isNull(partnerFirmsTable.capacity),
          sql`${partnerFirmsTable.capacity} > 0`,
        ),
      ),
    );

  if (eligible.length === 0) return null;

  const matter = criteria.matterType.toLowerCase();
  const region = criteria.region.toLowerCase();

  const specialtyAndRegion = eligible.find(
    (f) =>
      (f.matterTypes ?? []).some((m) => m.toLowerCase().includes(matter)) &&
      (f.regions ?? []).some((r) => r.toLowerCase().includes(region)),
  );
  if (specialtyAndRegion) return specialtyAndRegion;

  const regionOnly = eligible.find((f) =>
    (f.regions ?? []).some((r) => r.toLowerCase().includes(region)),
  );
  if (regionOnly) return regionOnly;

  const specialtyOnly = eligible.find((f) =>
    (f.matterTypes ?? []).some((m) => m.toLowerCase().includes(matter)),
  );
  if (specialtyOnly) return specialtyOnly;

  return eligible[0] ?? null;
}

// ---------------------------------------------------------------------------
// 3.2 Applicant push (PII travels ONLY here, inside the signed body)
// ---------------------------------------------------------------------------

/** Split a stored full name into first/last for the signed applicant object. */
function splitName(fullName: string | null): {
  firstName: string;
  lastName: string;
} {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Applicant", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

export interface ApplicantPushBody {
  referralId: string;
  funnelAssignmentId: string | null;
  funnelFirmId: string | null;
  matterType: string | null;
  urgency: string | null;
  region: string | null;
  summary: string | null;
  applicant: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    nationality: string | null;
    passportNumber: string | null;
    dateOfBirth: string | null;
  };
}

/**
 * Build the §3.2 push body. Note the field name is `funnelAssignmentId` here
 * (the token + callback use `assignmentId`).
 */
export function buildApplicantPushBody(args: {
  referralId: string;
  assignmentId: string | null;
  funnelFirmId: string | null;
  preview: ReferralPreview;
  lead: PrelaunchLead;
}): ApplicantPushBody {
  const { firstName, lastName } = splitName(args.lead.fullName);
  return {
    referralId: args.referralId,
    funnelAssignmentId: args.assignmentId,
    funnelFirmId: args.funnelFirmId,
    matterType: args.preview.matterType,
    urgency: args.preview.urgency,
    region: args.preview.region,
    summary: args.preview.summary,
    applicant: {
      firstName,
      lastName,
      email: args.lead.email ?? null,
      phone: args.lead.whatsapp ?? null,
      nationality: args.lead.nationality ?? null,
      // The funnel never collects a passport number or DOB — send null rather
      // than inventing values.
      passportNumber: null,
      dateOfBirth: null,
    },
  };
}

export type PushResult =
  | { ok: true; status: number }
  | { ok: false; reason: string; status?: number };

/**
 * POST the signed applicant push to the main EMA (§3.2). Fails closed when the
 * tunnel is not configured (missing secret / URL).
 */
export async function pushApplicantToEma(
  body: ApplicantPushBody,
): Promise<PushResult> {
  const secret = getReferralSecret();
  const emaUrl = getEmaAppUrl();
  if (!secret || !emaUrl) {
    return { ok: false, reason: "tunnel_not_configured" };
  }

  const signature = signBody(body, secret);
  const url = `${emaUrl}/api/referrals/ingest`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-referral-signature": signature,
      },
      // Send the exact stable serialization we signed so byte-for-byte the
      // signature matches what EMA recomputes.
      body: stableStringify(body),
    });
    if (!res.ok) {
      return { ok: false, reason: "ema_rejected", status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    logger.error({ err }, "applicant push to EMA failed");
    return { ok: false, reason: "network_error" };
  }
}

// ---------------------------------------------------------------------------
// 3.1 Redirect token
// ---------------------------------------------------------------------------

export interface MintedToken {
  token: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  redirectUrl: string;
}

/**
 * Mint a signed, short-lived, one-time redirect token and build the EMA
 * redirect URL (§3.1). Returns null when the tunnel is not configured (fail
 * closed — caller must not redirect).
 */
export function mintRedirectToken(args: {
  referralId: string;
  assignmentId?: string | null;
  funnelFirmId?: string | null;
}): MintedToken | null {
  const secret = getReferralSecret();
  const emaUrl = getEmaAppUrl();
  if (!secret || !emaUrl) return null;

  const issuedAt = Date.now();
  const expiresAt = issuedAt + REFERRAL_TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");

  const payload: ReferralTokenPayload = {
    referralId: args.referralId,
    intendedAction: INTENDED_ACTION,
    issuedAt,
    expiresAt,
    nonce,
  };
  if (args.assignmentId) payload.assignmentId = args.assignmentId;
  if (args.funnelFirmId) payload.funnelFirmId = args.funnelFirmId;

  const token = signReferralToken(payload, secret);
  const redirectUrl = `${emaUrl}/referral-gate?token=${encodeURIComponent(token)}`;

  return { token, nonce, issuedAt, expiresAt, redirectUrl };
}
