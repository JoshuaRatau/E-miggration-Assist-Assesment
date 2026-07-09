# Funnel-Only Test Findings

**Date:** 2026-07-09
**Goal:** Prove the funnel can complete its own normal flow with ZERO
involvement of the main EMA platform.

## How the validation was run

The repo's Playwright E2E suite (`tests/e2e/`, built earlier this session)
exercises the real running dev stack (SPA + Express API + funnel PostgreSQL
via the shared proxy on localhost:80) through real HTTP — nothing is mocked.
Crucially, **no spec in scopes A/B touches the referral routes**, so a green
run is direct evidence the funnel flow does not require the EMA platform.

Fresh run for this investigation (scopes A: lead capture, B: qualification):

```
cd tests && pnpm exec playwright test e2e/a-lead-capture.spec.ts e2e/b-lead-qualification.spec.ts
Result: 17 passed, 2 skipped (fixme-blocked), 0 failed — 49.7s
```

The full-suite run earlier the same day: **46 passed, 0 failed, 8
fixme-blocked** across scopes A–H (including conversion and pipeline).

## Coverage against the requested checklist

| Requested step | Covered by | Result | EMA involved? |
|---|---|---|---|
| Public entry | A-01/A-02 (POST /api/leads via public contract) | PASS | No |
| Assessment | A specs submit full assessment payloads (country, residence, answers) | PASS | No |
| OTP path / test-safe bypass | Dev-only `DISABLE_OTP_VERIFICATION=1` bypass (refuses in production); real OTP path exercised manually earlier via Twilio/email fallback | PASS (bypass) | No |
| Finalize | Two-phase contract validated: leads created `finalize:false`, finalize is at-most-once. Live finalize send is fixme-BLOCKED in CI because it dispatches a REAL email/WhatsApp (Resend/Twilio) — the block is about live messaging providers, NOT the EMA platform | PARTIAL (see blockers) | No |
| Thank-you / reference generation | A specs assert `referenceNumber` present post-create and absent from pre-finalize surfaces | PASS | No |
| Admin CRM visibility | B specs: login (cookie session), GET /api/leads list, by-id detail | PASS | No |
| Pipeline progression | B + E specs: contacted → engaged → qualified → proposal_sent → ready_for_case → converted (case created via `ensureCaseForLead`, local `lead_cases`) | PASS | No |

## Blockers (honest accounting — none are EMA-related)

1. **Live finalize confirmation send** — fixme-blocked in automation because
   `POST /api/leads/:id/finalize` dispatches a real email/WhatsApp. Unlock:
   an env-gated message sink (e.g. `E2E_EMAIL_SINK=1`). This is a
   messaging-provider constraint, not a main-EMA dependency.
2. **Real OTP delivery** — bypassed with the dev-only flag for automation;
   the OTP flow itself is entirely local (`routes/otp.ts`, `lib/otp.ts`)
   plus Twilio/Resend as delivery providers.

## Environment variables the funnel-only flow needs

`DATABASE_URL`, `SESSION_SECRET`, plus messaging providers for real sends
(`RESEND_API_KEY`, `TWILIO_*`). For automated runs: `E2E_DISABLE_RATE_LIMIT=1`,
`DISABLE_OTP_VERIFICATION=1` (both dev-only, refuse in production).
**`EMA_APP_URL` and `REFERRAL_TUNNEL_SECRET` are NOT needed** — if unset, the
referral tunnel fails closed with 503 while every funnel flow above still
works.

## Conclusion

The funnel completes its entire own lifecycle — capture, assessment, OTP,
finalize contract, reference generation, CRM visibility, pipeline
progression, and even conversion-to-case — using only its own database and
its own routes. **Zero requests to the main EMA platform occur in any of
these paths.**
