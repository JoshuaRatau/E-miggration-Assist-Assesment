# EMA Leads Funnel — E2E Test Plan

## Purpose

Automated end-to-end verification of the lead-capture funnel and admin CRM:
public assessment submission through qualification, outreach, conversion to a
case, pipeline visibility, negative/resilience handling, access control, and
auditability.

## Scope

| Scope | Area | Spec file |
|---|---|---|
| A | Lead capture (public funnel) | `tests/e2e/a-lead-capture.spec.ts` |
| B | Lead qualification (admin CRM) | `tests/e2e/b-lead-qualification.spec.ts` |
| C | Outreach workflow | `tests/e2e/c-outreach.spec.ts` |
| D | Conversion path | `tests/e2e/d-conversion.spec.ts` |
| E | Pipeline visibility | `tests/e2e/e-pipeline.spec.ts` |
| F | Negative & resilience | `tests/e2e/f-negative.spec.ts` |
| G | Roles & access (RBAC) | `tests/e2e/g-rbac.spec.ts` |
| H | Auditability | `tests/e2e/h-audit.spec.ts` |

Out of scope: email/WhatsApp delivery verification (external providers), the
separate main E-Migration Assist platform (referral receiver), load testing.

## Approach

- **Playwright** (`@playwright/test`), Chromium, single worker (shared DB).
- Tests run against the dev stack via the shared proxy (`http://localhost:80`),
  which serves the Vite SPA at `/` and the Express API at `/api`.
- API-first setup: leads are created via the same public endpoint the funnel
  form submits to (`POST /api/leads`, `finalize:false` so no email/WhatsApp is
  dispatched), then driven through the pipeline via admin routes. UI journeys
  (form walk, thank-you page, dashboard, lead detail, activity feed) are
  asserted in the browser using `data-testid` selectors.
- Console errors and failed network responses are captured for every test and
  attached to the report (`tests/support/fixtures.ts`).

## Test levels

- **Smoke** (`@smoke` tag): the shortest set proving the funnel is alive —
  capture, mandatory-field/consent enforcement, pipeline gate, conversion,
  admin auth. Run: `pnpm exec playwright test --grep @smoke`.
- **Regression** (everything): full behavior coverage including negative
  paths, idempotency, persistence, and audit assertions.

## Environment assumptions

See `tests/README.md`. Key ones: dev database (data is created, mutated,
archived/deleted by tests), `E2E_DISABLE_RATE_LIMIT=1` and
`DISABLE_OTP_VERIFICATION=1` set on the API server (both are dev-only
bypasses; production behavior is rate-limited and OTP-gated), seeded demo
admin available.

## Honesty rules

- No faked success: blocked tests are `test.fixme(...)` with the unlock
  condition documented in-line.
- Known product defects are `test.fail()` (test asserts the *correct*
  business behavior and is expected to fail until the defect is fixed) and
  are logged in `docs/leads-funnel-defect-log-template.md`.

## Coverage matrix

| Requirement | Status | Notes |
|---|---|---|
| A: happy-path submission (API + UI walk) | Covered | UI walk to OTP gate; full OTP UI walk blocked (see below) |
| A: required fields / consent enforced | Covered | |
| A: invalid email rejected | **Blocked by defect** | DEF-001 — API accepts any string as email |
| A: invalid phone rejected | **Blocked by defect** | DEF-002 — invalid WhatsApp silently dropped |
| A: duplicate lead handling | Covered | 409 + existing reference returned |
| A: honeypot bot rejection | Covered | Synthetic 201, no row stored |
| A: thank-you page reference | Covered | |
| A: OTP verification UI walk | Blocked | Real OTP delivery required; bypass env used for API tests |
| B: status transitions | Covered | |
| B: assign owner | Covered | |
| B: internal notes | Covered | |
| B: follow-up scheduling | Covered | |
| B: persistence across re-login | Covered | |
| B: tags (source/city/segment) | Blocked | No tag-editing API/UI exists |
| C: outreach action → timeline | Covered | |
| C: follow-up completion stamps last-contacted | Covered | |
| C: campaign email send | Blocked | Sends real email via Resend; not safe in E2E |
| D: pipeline gate (converted requires ready_for_case) | Covered | |
| D: conversion creates a case | Covered | |
| D: conversion idempotency | Covered | Via /convert short-circuit |
| D: demo booking | Not automatable yet | Feature does not exist |
| E: stage membership + counts | Covered | |
| E: dashboard filters | Covered | |
| F: incomplete form cannot advance | Covered | |
| F: invalid transitions / bogus values rejected | Covered | |
| F: unauthorized access rejected | Covered | |
| F: email-provider outage resilience | Blocked | Cannot fault-inject Resend from E2E |
| G: unauthenticated blocked from admin | Covered | |
| G: standard admin vs superadmin (user management) | Covered | |
| G: cross-tenant leakage | Not applicable | Single-tenant system |
| H: status/note/assignment audit entries | Covered | |
| H: audit visible in activity feed UI | Covered | |
