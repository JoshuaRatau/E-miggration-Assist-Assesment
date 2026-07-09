# Integration Boundary Findings

**Date:** 2026-07-09
**Goal:** Identify exactly where and how the funnel legitimately interacts
with the main EMA platform, and pin down WHEN company matching happens.

## The exact boundary

There is precisely **one outbound integration point** and **one inbound one**:

1. **Outbound — applicant hand-off (the tunnel push):**
   `GET /api/referral-gate/redirect/:referralId`
   (`artifacts/api-server/src/routes/referralGate.ts`)
   Fired when a partner firm clicks "Accept & Open in EMA" on the redacted
   preview page. It (a) POSTs the full applicant details in a signed
   (HMAC-SHA256, key-sorted-body serialization) request to
   `{EMA_APP_URL}/api/referrals/ingest`, then (b) 302-redirects the firm's
   browser to `{EMA_APP_URL}/referral-gate?token=<signed redirect token>`
   (second, deliberate serialization — the two must not be unified).

2. **Inbound — conversion callback:**
   `POST /api/referral-gate/callback` — EMA reports the referral outcome via
   a signature-verified webhook; the funnel marks the local `referrals` row
   `converted` (terminal, idempotent). No data is read back from EMA.

## Gate characteristics (verified in code)

| Property | Status | Evidence |
|---|---|---|
| Consent-gated | **YES** | `POST /api/referrals/consent` zod-requires `consentToShareWithPartnerFirms: z.literal(true)`; missing/false → 400 `consent_required` (fail closed). No referral row can exist without it |
| Status-gated | **YES** | Referral lifecycle `offered → accepted/… → converted`; the push fires only from the accept-redirect; `converted` is terminal |
| API-driven | **YES** | Signed HTTP only: outbound push + browser redirect + inbound callback |
| Callback-driven | **YES** (for conversion status) | `/api/referral-gate/callback`, signature-verified |
| Database-driven | **NO** | No shared DB, no EMA connection string, no cross-database queries anywhere in the repo |
| Fail-closed | **YES** | `isTunnelConfigured()` requires BOTH `EMA_APP_URL` and `REFERRAL_TUNNEL_SECRET`; unset ⇒ 503, never a silent fallback |
| PII discipline | **YES (structural)** | The `referrals` table has NO name/email/phone columns; applicant PII travels only inside the signed push body |

## When does company (firm) matching happen?

| Candidate timing | Happens here? |
|---|---|
| Before finalize | **No** |
| During qualification | **No** |
| At ready_for_case | **No** |
| At converted (CRM conversion) | **No** — `ensureCaseForLead` is purely local |
| **After finalize, at explicit consent on the thank-you page** | **YES** — `POST /api/referrals/consent` → `matchPartnerFirm()` against the LOCAL `partner_firms` table |
| At referral dispatch (push to EMA) | No new matching — the firm chosen at consent time is the one that accepts |
| Only in main EMA after handoff | Whatever EMA does internally after ingest is outside this repo; the funnel's matching is complete before the push |

**Sequence:** finalize → thank-you page → applicant consents → local match →
local `referrals` row (`offered`) → redacted email to firm → firm accepts →
**[BOUNDARY]** signed push + redirect to EMA → EMA callback → `converted`.

## Important nuance

"Firm matching" is a **funnel-local** operation over the funnel's own
admin-managed `partner_firms` registry. The main EMA platform's firm/company
database is never queried by the funnel — at the boundary the funnel *tells*
EMA about the applicant; it never *asks* EMA about companies.
