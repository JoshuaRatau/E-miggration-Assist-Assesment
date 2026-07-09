# Funnel Dependency Map — company / firm / referral lookups

**Date:** 2026-07-09
Legend for "class": **(1)** funnel-DB-local · **(2)** internal CRM logic · **(3)** referral-boundary logic · **(4)** external main-EMA integration

## Lookup-by-lookup map

| # | Screen / action (trigger) | Backend route | Service / function | Depends on | Class |
|---|---|---|---|---|---|
| 1 | Public assessment form — B2B org fields | `POST /api/leads` (`routes/leads.ts`) | insert into leads | `prelaunch_leads.organization_name` etc. (funnel DB) | (1) |
| 2 | Admin lead list / detail — org & contact card | `GET /api/leads`, `GET /api/leads/by-id/:id` | serializers in `routes/leads.ts` / `routes/adminLeads.ts` | `prelaunch_leads` (funnel DB) | (2) |
| 3 | Admin partner-firm management | `GET/POST/PATCH /api/admin/partner-firms` | `routes/adminPartnerFirms.ts` | `partner_firms` (funnel DB, admin-managed; NOT synced from EMA) | (1)/(2) |
| 4 | Thank-you page "Match me with a firm" (POPIA consent) — `referral-consent-card.tsx` | `POST /api/referrals/consent` (`routes/referrals.ts`) | `matchPartnerFirm()` + `deriveReferralPreview()` in `lib/referralService.ts` | `partner_firms` + `referrals` + `prelaunch_leads` (all funnel DB); firm notification email via Resend | (3) — but data access is 100% local |
| 5 | Firm views redacted preview — `referral-preview.tsx` | `GET /api/referrals/:id/preview` | `routes/referrals.ts` | `referrals` (funnel DB; table structurally holds NO applicant PII) | (3) |
| 6 | Firm clicks "Accept & Open in EMA" | `GET /api/referral-gate/redirect/:referralId` (`routes/referralGate.ts`) | `mintRedirectToken()`, `pushApplicantToEma()`, `signBody()` (`lib/referralTunnel.ts`) | **External:** signed `POST {EMA_APP_URL}/api/referrals/ingest`, then 302 to `{EMA_APP_URL}/referral-gate?token=…` | **(4)** — the ONLY outbound call |
| 7 | EMA notifies conversion | `POST /api/referral-gate/callback` | `verifyBodySignature()` | Inbound signed webhook; updates local `referrals.status` (terminal, idempotent) | (4) inbound |
| 8 | Admin converts lead (kanban/detail) | `PATCH /api/admin/leads/:id` status→converted; `POST /api/admin/leads/:id/convert` | `ensureCaseForLead()` (`lib/cases.ts`) | `lead_cases` (funnel DB). **No EMA involvement.** | (2) |
| 9 | Portal prepare/activate | `POST …/prepare-portal`, `POST …/activate-portal` | `prepareCasePortal()`, `activateCasePortal()` (`lib/cases.ts`) | `lead_cases.portal_status` (funnel DB). No client-facing or EMA side effects | (2) |

## Flow diagram (text)

```
PUBLIC FUNNEL (all funnel-local, classes 1-2)
  assessment -> OTP -> lead insert (finalize:false) -> finalize -> thank-you
                                                          |
                                       [OPTIONAL, consent-gated]
                                                          v
REFERRAL BOUNDARY (class 3, still funnel-local data)
  POST /api/referrals/consent
    -> matchPartnerFirm()  ...... reads LOCAL partner_firms only
    -> insert LOCAL referrals row (status=offered, NO PII columns)
    -> email redacted preview to firm
                                                          |
                                       [firm clicks Accept]
                                                          v
EXTERNAL INTEGRATION (class 4 — the ONLY main-EMA touchpoint)
  GET /api/referral-gate/redirect/:id
    -> pushApplicantToEma(): signed POST {EMA_APP_URL}/api/referrals/ingest
    -> 302 firm browser to {EMA_APP_URL}/referral-gate?token=HMAC
  POST /api/referral-gate/callback  <- EMA reports converted (signed, inbound)

ADMIN CRM (classes 1-2, zero EMA involvement)
  pipeline moves, notes, follow-ups, ensureCaseForLead, portal prep/activate
```

## Key facts

- `EMA_APP_URL` is referenced in exactly one file: `lib/referralTunnel.ts`.
- `pushApplicantToEma` is called from exactly one route: `referralGate.ts`.
- `partner_firms` data source: created/edited in this app's admin UI.
  There is no sync job, no import from EMA, no foreign connection.
- There is no second `DATABASE_URL`, no EMA connection string, and no
  cross-database query anywhere in the repo.
