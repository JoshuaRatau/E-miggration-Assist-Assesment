# Testing Maturity Analysis

## What exists

**Playwright E2E** in `tests/e2e/`, organized into 8 scopes:

| Scope | File | Covers |
|---|---|---|
| A | `a-lead-capture.spec.ts` | Public funnel submission, happy + unhappy paths, honeypot |
| B | `b-lead-qualification.spec.ts` | Admin CRM: status moves, assignment, notes, follow-ups |
| C | `c-outreach.spec.ts` | Outreach actions + timeline verification |
| D | `d-conversion.spec.ts` | Lead→case conversion path |
| E | `e-pipeline.spec.ts` | Pipeline/dashboard visibility |
| F | `f-negative.spec.ts` | Negative paths / resilience |
| G | `g-rbac.spec.ts` | Access control (admin vs superadmin, unauthenticated) |
| H | `h-audit.spec.ts` | Audit-trail verification |

## Smoke vs regression

- `@smoke` tag marks the core-life subset (capture, consent, conversion, admin auth): `pnpm exec playwright test --grep @smoke`.
- The full suite is the regression layer: negative paths, idempotency, RBAC, audit.

## Deliberate markers (honesty encoded in the suite)

- **`test.fail` — known defects, expected to fail:** DEF-001 (invalid email accepted by intake), DEF-002 (invalid WhatsApp silently dropped). When these start passing, the markers must be removed.
- **`test.fixme` — blocked:** full UI walks needing a real OTP delivery; campaign-send tests blocked to avoid real emails.
- **`test.skip` — not built:** e.g. demo booking.

## Test-only environment bypasses

- `E2E_DISABLE_RATE_LIMIT=1` (skips IP/email/WA buckets) and `DISABLE_OTP_VERIFICATION=1` (skips OTP gate). **Both hard-refused when `NODE_ENV=production`.**
- Practical gotchas: audit writes are fire-and-forget so tests must poll; the admin list caps at 50 rows; `/convert` has an inquiryType gate; long runs are chunked.

## Coverage gaps (what is NOT tested)

- No unit-test layer of note — coverage is E2E-first. Notably missing: a unit test for the EMA match-response parser (`emaFirmDirectory.ts`) covering the live payload shape (nullable preview fields) — this exact gap caused a production incident in July 2026.
- Campaign delivery, WhatsApp sending, and the referral tunnel's EMA round-trip are untested end-to-end (external dependencies) — verified manually/in dev instead.
- No load/performance testing.

## Maturity verdict

**Mid-maturity, unusually honest.** The suite covers the money paths (capture → qualify → convert) and encodes known defects and blockers explicitly rather than hiding them. The main structural weakness is the absence of fast unit/contract tests around external integration parsers (EMA, Twilio, Resend), where real-world shape drift is the dominant failure mode.
