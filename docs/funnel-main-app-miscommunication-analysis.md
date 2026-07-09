# Funnel ↔ Main-App Miscommunication Analysis

**Date:** 2026-07-09
**Question investigated:** Is the funnel incorrectly depending on the main EMA application database (or a main-app company lookup) too early in its flow?

## Verdict

**No coupling defect exists. The funnel is correctly isolated.**

The funnel NEVER queries, connects to, or reads from the main EMA application's
database at any point. There is no shared database, no cross-database
connection string, and no "company lookup in the main app" anywhere in this
repo. The only interaction with the main EMA platform is **outbound, signed
HTTP** at the referral boundary — and even that fires only after (a) explicit
POPIA consent, and (b) a partner firm actively accepts the referral.

If a test or a person observed the system "looking for the company in the main
application database," that observation is a **misunderstanding**, most likely
one of:

1. **Terminology collision** — "the company" can mean three unrelated things
   in this system (see below), and two of them are 100% funnel-local.
2. **Mistaking `partner_firms` for main-EMA data** — the firm-matching table
   lives in the FUNNEL's own PostgreSQL and is admin-managed inside this app.
   It is a local registry of referral targets, not a mirror or query of the
   EMA platform's firm database.
3. **Mistaking the tunnel push for a lookup** — `pushApplicantToEma()` is a
   one-way WRITE (signed POST to `{EMA_APP_URL}/api/referrals/ingest`), not a
   read/lookup, and it only fires at firm-acceptance time.

## The three meanings of "company" in this repo (all local)

| Term | What it is | Where it lives | When used |
|---|---|---|---|
| `organizationName` (+ B2B fields) | Descriptive attribute of a professional/B2B **lead** | `prelaunch_leads` columns (funnel DB) | Captured on the public form / CSV import; displayed in CRM |
| `partner_firms` | The funnel's own registry of vetted referral-target firms | `partner_firms` table (funnel DB), schema `lib/db/src/schema/referrals.ts` | Queried by `matchPartnerFirm()` ONLY after post-thank-you consent |
| The receiving firm inside main EMA | An account in the SEPARATE platform | Main EMA's own DB — **never touched by this repo** | Only after the signed hand-off; the funnel never reads it |

## Evidence (exact code)

- `artifacts/api-server/src/lib/referralService.ts → matchPartnerFirm()`
  queries `partnerFirmsTable` via the funnel's own Drizzle `db` handle
  (bound to this repo's `DATABASE_URL`). Filters: `active=true`,
  `vetting_status='vetted'`, capacity null-or-positive; then priority match
  on specialty+region → region → any. Purely local SQL.
- `artifacts/api-server/src/lib/referralTunnel.ts` — the ONLY file that knows
  the main app exists. It reads `EMA_APP_URL` + `REFERRAL_TUNNEL_SECRET` and
  exposes HMAC signing helpers. `isTunnelConfigured()` returns false when
  either is unset; routes fail closed with 503 instead of guessing.
- `pushApplicantToEma()` (referralService.ts) is invoked from ONE route:
  `GET /api/referral-gate/redirect/:referralId`
  (`artifacts/api-server/src/routes/referralGate.ts`) — i.e. only when a firm
  clicks "Accept & Open in EMA".
- The entire public flow (`routes/leads.ts`, `routes/otp.ts`, finalize,
  status lookup) and the entire admin CRM (leads PATCH, `ensureCaseForLead`
  in `lib/cases.ts`, portal prepare/activate) contain zero references to
  `EMA_APP_URL`, the tunnel, or any external datastore. Grep evidence:
  `EMA_APP_URL` appears only in `referralTunnel.ts`;
  `pushApplicantToEma` is called only from `referralGate.ts`.

## Diagnosis classification (per the requested options)

| Option | Applies? |
|---|---|
| 1. Expected by design | **Partially** — outbound EMA interaction IS designed, but only at the referral boundary |
| 2. Only expected at conversion/referral stage | **Yes — this is the accurate framing.** External contact happens exclusively at referral acceptance |
| 3. A bug | No — no early coupling found in code |
| 4. A test misunderstanding | **Most likely root cause of the report** — see terminology collision above |
| 5. Environment/configuration issue | Not for the funnel flow. Note: `EMA_APP_URL` being set in dev does NOT change funnel behavior; the tunnel is dormant until firm acceptance |

## Final answer

**Should the funnel need the main EMA company database to perform this flow?**

**No.** The funnel completes public capture → OTP → finalize → thank-you →
CRM visibility → pipeline progression → conversion entirely against its own
database (fresh proof: 17/17 funnel-only E2E tests passed with no EMA
involvement — see `funnel-only-test-findings.md`). Firm matching uses the
funnel's OWN `partner_firms` table. The main EMA platform is contacted only
via signed one-way HTTP after consent + firm acceptance. Any expectation that
a main-app company lookup should (or does) happen earlier is a
misunderstanding, not a code defect.
