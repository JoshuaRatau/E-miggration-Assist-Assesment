---
name: Audit-row PII discipline
description: What may and may not be persisted into lead_audit `after`/`before` JSON.
---

# Audit rows must never carry raw provider/exception strings

When writing a `lead_audit` row (via `writeAudit`), the persisted `before`/`after`
JSON must contain only SAFE, controlled values: reason CODES, fixed string
constants, enums, timestamps, and static labels.

**Never persist into audit JSON:**
- Raw email-provider error strings (`SendResult.reason`) — they can echo the
  recipient address or message body.
- `err.message` from a caught exception — same leak risk.
- Recipient email/phone, names, or any other lead PII.

**How to apply:** map failures to a controlled code before `writeAudit`
(e.g. `forbidden_phrase` / `provider_error` / `send_exception` /
`not_ready` / `already_sent`). Put the raw diagnostic string in `req.log`
(structured logs) ONLY — the email layer already redacts recipients there.

**Why:** audit rows live in the DB indefinitely and are surfaced in the admin
activity feed; a raw provider string is an uncontrolled sink for PII. Caught in
code review on the Phase 14B activation-email send (`email_activation_failed`
originally wrote `result.reason`/`err.message` verbatim).
