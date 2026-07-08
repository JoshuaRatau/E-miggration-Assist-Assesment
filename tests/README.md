# EMA Leads Funnel — E2E Test Suite

Playwright end-to-end tests for the public assessment funnel and admin CRM.
Scopes A–H (lead capture, qualification, outreach, conversion, pipeline,
negative/resilience, RBAC, auditability). Documentation lives in `/docs`:

- `leads-funnel-test-plan.md` — scope, approach, coverage matrix
- `leads-funnel-test-cases.md` — every case with ID + status
- `leads-funnel-test-data.md` — data conventions and cleanup
- `leads-funnel-defect-log-template.md` — open defects (DEF-001, DEF-002) + template
- `leads-funnel-results-template.md` — run-report template

## Setup

1. Install deps at the repo root: `pnpm install`.
2. Chromium: the Playwright-bundled browser does not run on NixOS; the config
   auto-detects the **system** chromium (`which chromium`) and uses it. Ensure
   the `chromium` system package is installed.
3. Start the app workflows (web on `/`, API on `/api`) — tests hit the shared
   proxy at `http://localhost:80`.

## Environment variables

Set on the **API server** (dev only — both are refused in production):

| Var | Purpose |
|---|---|
| `E2E_DISABLE_RATE_LIMIT=1` | Bypass public-endpoint rate limiting so rapid test submissions don't 429 |
| `DISABLE_OTP_VERIFICATION=1` | Skip the OTP contact-verification gate on `POST /api/leads` |

Optional for the test runner:

| Var | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:80` | Target base URL |
| `E2E_ADMIN_EMAIL` | `demo@admin.local` | Admin login |
| `E2E_ADMIN_PASSWORD` | `ChangeMe!2026` | Admin password |

## How to run

From `tests/`:

```bash
pnpm exec playwright test                 # full regression suite
pnpm exec playwright test --grep @smoke   # smoke set only
pnpm exec playwright test e2e/a-lead-capture.spec.ts   # one scope
pnpm exec playwright show-report          # open the HTML report
```

Failures attach screenshot, video, and trace under `test-results/`, plus
captured browser console errors and failed network responses.

## Assumptions & honesty rules

- Runs against the **development** database; tests create/mutate/delete data.
  Test rows are identifiable (`E2E Test` names, `e2e-*@example.com` emails).
- Leads are created with `finalize:false` → **no real email/WhatsApp is ever
  sent** for test data.
- `workers: 1` — tests share one DB and must not run in parallel.
- Blocked tests are explicit `test.fixme(...)` with the unlock condition
  documented. Nothing is faked as passing.
- Known product defects are `test.fail()` (the test asserts correct business
  behavior and is expected to fail until the defect is fixed) and logged in
  the defect log.
