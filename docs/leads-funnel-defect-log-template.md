# EMA Leads Funnel — Defect Log

Template columns: ID, Title, Scope, Severity, Steps, Expected, Actual,
Evidence (spec + test), Status.

## Open defects found by the automated suite

### DEF-001 — API accepts invalid email formats

- **Scope:** A (lead capture) · **Severity:** Medium
- **Steps:** `POST /api/leads` with `email: "not-an-email"` (all other
  required fields valid).
- **Expected:** 4xx validation error — undeliverable addresses should be
  rejected so the team never chases dead contacts and confirmation emails
  never bounce.
- **Actual:** `201 Created` — the lead row is stored with the malformed
  address. Server-side schema validates only that email is a string.
- **Evidence:** `tests/e2e/a-lead-capture.spec.ts` → "invalid email is
  rejected" (marked `test.fail()` — remove the marker once fixed).
- **Status:** Open.

### DEF-002 — Invalid WhatsApp numbers silently discarded

- **Scope:** A (lead capture) · **Severity:** Medium
- **Steps:** `POST /api/leads` with `whatsapp: "12345"`.
- **Expected:** 4xx validation error — the applicant should be told their
  number is invalid so they can correct it.
- **Actual:** `201 Created` — the server normalizes the invalid number to
  null and stores the lead WITHOUT a usable phone number; the applicant is
  never informed and WhatsApp outreach to them is impossible.
- **Evidence:** `tests/e2e/a-lead-capture.spec.ts` → "invalid phone
  (WhatsApp) format is rejected" (marked `test.fail()`).
- **Status:** Open.

## Template for new entries

### DEF-XXX — <title>

- **Scope:** <A–H> · **Severity:** Critical / High / Medium / Low
- **Steps:** <numbered reproduction steps>
- **Expected:** <business-outcome expectation>
- **Actual:** <observed behavior>
- **Evidence:** <spec file + test name, screenshot/trace path>
- **Status:** Open / Fixed (<date>) / Won't fix (<reason>)
