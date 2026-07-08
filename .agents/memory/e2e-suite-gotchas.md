---
name: E2E suite gotchas
description: Non-obvious constraints hit while building/running the Playwright E2E suite against the dev stack.
---

- **Dev-only bypasses required:** API tests need `E2E_DISABLE_RATE_LIMIT=1` and `DISABLE_OTP_VERIFICATION=1` on the api-server (both refuse in production). Without them public lead creation 429s or 400s with "Contact verification is required".
- **Chromium:** Playwright's bundled browser fails on NixOS (missing libglib); config auto-detects system chromium via `which chromium` — keep the `chromium` system package installed.
- **Audit writes are fire-and-forget** (`void writeAudit`): a timeline read can lag the mutation. Tests must poll (`waitForTimelineMatch` in tests/support/api.ts), never assert on a single read.
- **POST /convert readiness gate needs `inquiryType`** (→ matterType) which is NOT settable via the public funnel or admin PATCH (only overstay intake sets it). Case creation in tests goes through PATCH status→converted; /convert is only usable as the idempotent already-converted retry.
- **GET /api/leads caps at 50 rows** — never assert absolute counts on busy stages; use a sparse stage (e.g. proposal_sent) or membership checks.
- **Detail serializer field is `leadStatus`**, not `status`.
- **assignable-users returns `{users:[...]}`**, timeline is `/api/admin/leads/:id/timeline` (audit+engagement), `/events` is the scoring event stream.
- **Known product defects (kept as `test.fail()` in scope A):** invalid email accepted with 201 (no format validation), invalid WhatsApp silently normalized to null and stored. Logged as DEF-001/DEF-002 in docs/leads-funnel-defect-log-template.md — remove the markers when fixed.
- Bash tool has 120s cap; full suite >115s — run specs in chunks of 3-4 files.
