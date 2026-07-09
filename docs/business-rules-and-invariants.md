# Business Rules & Invariants

Every rule below is enforced in code (file references included). These are the guarantees an operator can rely on.

## Lead capture & finalize

- **Two-phase submission:** the lead row commits at the Terms step with `finalize:false` (nothing dispatched). Confirmation email/WhatsApp fires only on `POST /leads/:id/finalize`, and is **at-most-once** — skipped if a `confirmation` engagement row already exists (`lib/confirmation.ts`). `finalize` defaults to true for back-compat.
- **Reference numbers are post-finalize-only:** generated server-side at insert but first revealed on `/thank-you/:reference` — never inside the assessment flow.
- **Honeypot:** the hidden `website` field must never be rendered; if filled, the API returns a synthetic 201 with no DB write or side effects (`routes/leads.ts`).
- **Rate limiting:** independent sliding-window buckets for IP, email, and WhatsApp; email/WA buckets are charged only post-OTP verification (prevents lockout attacks). `E2E_DISABLE_RATE_LIMIT` and `DISABLE_OTP_VERIFICATION` bypasses are **refused in production**.
- **OTP:** 6-digit, SHA-256-hashed at rest, 10-minute TTL, 5 attempts max, consumed once. WhatsApp preferred, email fallback.

## Lead pipeline

- Statuses move **both ways** (operators can drag back), with ONE hard gate: entering `converted` requires current status `ready_for_case` — enforced **atomically in the PATCH WHERE-clause** in `routes/adminLeads.ts` (409 on violation, closes the TOCTOU race — this is the authoritative gate; `lib/classification.ts → canAdvanceStatus` is a forward-move helper used for scoring-event emission). The same PATCH triggers case creation.
- Adding a `lead_status` value requires touching ~9 hardcoded sites incl. a type-required kanban Record (see `.agents/memory/lead-status-enum-sites.md`).
- **Ownership:** assigning to a deactivated admin is rejected, but a lead already owned by a now-inactive user may be re-PATCHed (compares against the before snapshot). Audit snapshots the assignee NAME.
- **Follow-ups:** a follow-up note may never outlive its due date — if the due date resolves to null, the note is force-nulled. Completion stamps `lastContactedAt`.
- **Internal notes:** append-only `lead_audit` rows; the POST **awaits** the insert and 500s on failure — user-intent data must never be silently lost. (All other audit writes are fire-and-forget.)
- **Archive/delete:** soft-archive via `archived_at`; delete is atomic (`SELECT … FOR UPDATE`, 409 if a linked case exists), cascades children but **keeps `lead_audit`**.

## Conversion, cases & portal

- **One case per lead:** `ensureCaseForLead` uses `ON CONFLICT (lead_id) DO NOTHING` — conversion is idempotent.
- **Case statuses are forward-only:** `initiated → in_review → documents_requested → submitted → closed`; regressions get 409 (`lib/caseStatus.ts`).
- **Portal state machine** (`lib/cases.ts`, both transitions in a `FOR UPDATE` transaction, race-safe, `changed=true` for exactly one winner):
  - *Prepare:* requires `workflow_status='assigned'` (else `blocked_review`, state untouched). `not_prepared`/`manual_review_required` → `ready_to_activate`.
  - *Activate:* requires `portal_status='ready_to_activate'`. `activated` is **terminal, never downgraded**; re-runs are silent success.
  - Neither action creates credentials, sends anything, or exposes anything publicly — they flip one status column for a future phase.

## Campaigns & outreach

- Audience queries compile through a **closed 12-field allow-list** (32-rule cap, single-level AND/OR); empty rule lists are refused (no accidental send-to-all).
- Merge tokens are exactly 4: `{{first_name}} {{full_name}} {{reference}} {{organization_name}}` — no logic/loops (injection safety).
- Rich-text HTML is DOMPurify-sanitised on **both write and render**.
- Sends return **202** and are queue-processed: atomic `draft→sending` claim, atomic per-recipient claim (no double-send), single-winner finaliser. Pause is best-effort (in-flight batch drains). Scheduled campaigns stay editable until claimed; audience is re-evaluated at fire time.
- 2000-recipient cap per send.
- Unsubscribe: HMAC-signed RFC-8058 one-click; `timingSafeEqual` comparison; **fails closed in production** if neither `UNSUBSCRIBE_SECRET` nor `SESSION_SECRET` is set.
- All email sends FROM `noreply@emigration-assist.com` — the domain must be verified in Resend or sends bounce.

## Referral tunnel (consent + PII discipline)

- **Consent-gated:** no referral exists without explicit POPIA consent; consent creation locks the lead row `FOR UPDATE`.
- **EMA is the sole matcher:** the funnel does NO local firm matching. Signed non-PII match request (leadReference/matterType/region/urgency/route/theme); signature = base64url-unpadded HMAC-SHA256 over key-sorted stableStringify.
- **Two deliberate HMAC serializations** (redirect-token body vs. server-to-server key-sorted body) — do not unify.
- `matched:true` **requires** `firmId + firm name + acceptUrl`, else treated as unavailable — the offer email never goes out without EMA's signed accept URL, and there is no funnel-minted fallback link.
- No match / EMA down ⇒ referral recorded honestly UNMATCHED, **no email** — never a fake match.
- **Structural PII guarantee:** the `referrals` table has no name/email/phone columns. `acceptUrl` is never persisted.
- `converted` callback is terminal and idempotent. Missing `REFERRAL_TUNNEL_SECRET` ⇒ 503 (fail-closed).

## Security fail-closed inventory

| Surface | Behavior when unconfigured/invalid |
|---|---|
| WhatsApp webhook | 503 without secret; signature verified (Twilio HMAC) |
| Billing webhook | HMAC required (`EMIGRATION_WEBHOOK_SECRET`) |
| Referral tunnel | 503 without `REFERRAL_TUNNEL_SECRET` |
| Unsubscribe | fails closed in prod without HMAC secret |
| CORS boot | prod refuses to start if `CROSS_SITE_COOKIES=true` && no `WEB_ORIGIN` |
| Dev bypasses | `E2E_DISABLE_RATE_LIMIT`, `DISABLE_OTP_VERIFICATION` refused in production |

## Audit discipline

- Every privileged admin mutation writes an append-only `lead_audit` row; actor credential sha256-hashed (raw never stored).
- Audit `before/after` JSON holds only reason CODES/constants/timestamps — raw provider errors and recipient PII go to `req.log` only.
- `referral_audit` is strictly non-identifying.
