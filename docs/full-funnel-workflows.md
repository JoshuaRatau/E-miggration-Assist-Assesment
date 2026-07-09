# Full Funnel Workflows — End to End

Each workflow: trigger → steps → surfaces → tables → rules → side effects → failure/edge cases.

## A. Public assessment funnel (individual)

- **Trigger:** visitor picks a route on `/` and lands on `/assessment`.
- **Steps:** 5 core steps (dynamic 7/8 with the optional document-upload gate) → contact details → OTP verify → Terms → submit → finalize → thank-you.
- **Frontend:** `pages/assessment.tsx` (+ `CountryCombobox`, `WhatsAppInput`, `DocumentUploader`).
- **Backend:** `POST /otp/request|verify`, `POST /leads` (finalize:false at Terms), `POST /leads/:id/finalize`, document routes.
- **Tables:** `prelaunch_leads`, `lead_otps`, `prelaunch_documents`, `lead_engagements`, `lead_events`, `analytics_events`.
- **Rules:** two-phase commit; at-most-once confirmation; reference revealed only at `/thank-you/:reference`; honeypot synthetic 201; rate limits; inside/outside-SA residence handling; session-scoped document listing.
- **Side effects:** confirmation email/WhatsApp on finalize; `lead_created`/`assessment_completed` scoring events; Meta Pixel `Lead`/`SubmitApplication`.
- **Edge cases:** abandoned-at-Terms leads exist with no confirmation; OTP max-attempts lockout; known defects DEF-001/DEF-002 (invalid email accepted / invalid WhatsApp silently dropped — tracked in tests).

## B. Segment landing funnels (overstay, business/firm)

- `/overstay(-assessment)` → `POST /overstay-intake`; `/business(-assessment)` → `POST /business-intake`. "Stuck application" traffic funnels to `/assessment` (no dedicated route).
- Pattern: dedicated page + dedicated intake route, **no new DB columns** — rich answers stored as JSON in admin notes; `funnel_context` jsonb records route/theme. Backend enforces required fields (not in OpenAPI).
- All three lead-creating paths (leads / overstay-intake / business-intake) must stay in sync for funnel_context.

## C. OTP verification

`POST /otp/request` (WhatsApp template first, email fallback) → user enters code → `POST /otp/verify`. Hashed, 10-min TTL, 5 attempts, single-use. Email/WA rate buckets charge only after verification.

## D–F. Finalize, thank-you, status lookup

- Finalize (D): fires the one confirmation; idempotent re-calls skip.
- Thank-you (E): `/thank-you/:reference` reveals reference + personalised next steps via `GET /api/leads/:referenceNumber`.
- Status lookup (F): `/status` → `GET /api/public/status/:referenceNumber` (neutral, minimal-PII view incl. document count); no login; rate-limited.

## G. Admin login / auth

`/admin/login` → `POST /admin/auth/login` → opaque session in httpOnly `ema_admin_session` cookie (7d). Forgot/reset via 1-hour single-use hashed token. Legacy `x-admin-token` still honoured. Demo superadmin seeded when `admin_users` is empty.

## H–K. Lead management, pipeline, notes/ownership/follow-ups, dashboard

- **Dashboard `/admin`:** KPI strip, saved views, filter chips (incl. "Assigned To"), 4-way client-side segment model (overstay is a sub-filter of individuals), kanban pipeline with optimistic drag + server re-validation/rollback.
- **Pipeline (I):** bidirectional moves; single hard gate `ready_for_case → converted` (atomic; same PATCH creates the case).
- **Notes/ownership/follow-ups (J):** append-only notes (awaited insert), soft-ref ownership with active-assignee rule, follow-up due-date+note invariant, archive/restore, atomic delete (409 if case exists).
- **Detail (`/admin/lead/:id`):** full lead via `/leads/by-id/:id` (slim list omits adminNotes), timeline (audit+engagements), 1-to-1 send-update, convert, Client Portal card.

## L. Scoring / events / audit

Every meaningful action appends `lead_events` (points snapshotted); the 60s score worker recomputes `lead_score`. Every privileged mutation appends `lead_audit` (hashed actor, before/after codes only). Timeline = audit + engagements merged.

## M–N. Campaigns & templates

- Create in `/admin/communications` → edit audience (allow-listed query builder) + content (TipTap, DOMPurify both ways) → preview (4 merge tokens) → send now (**202**, queue, poll counters) or schedule (30s tick; editable until claimed; audience re-evaluated at fire time) → pause/resume (best-effort).
- Templates: reusable per-channel bodies; subject required for email; channel locked after create; archived immutable; ~20 defaults seeded.
- Suppression: unsubscribes checked per recipient; HMAC one-click unsubscribe footer (needs `PUBLIC_BASE_URL`).

## O. Lead-to-case conversion

`POST /admin/leads/:id/convert` or the status PATCH gate. Idempotent (`ON CONFLICT (lead_id) DO NOTHING`). Case gets a workflow auto-attach (`workflow_status: assigned` or `review_required`). Case statuses forward-only thereafter. `/convert` has an inquiryType gate (some inquiry types refuse conversion).

## P. Client portal preparation & activation email

- **State machine:** Prepare (`assigned` workflow required) → `ready_to_activate` → Activate → `activated` (terminal). Race-safe, idempotent, audited (`portal_prepared`/`portal_activated`/`portal_activation_blocked`/`portal_activation_failed`). The status transitions themselves create no credentials and expose nothing publicly.
- **Activation email (Phase 14B — LIVE):** `POST /admin/leads/:id/send-activation-email` sends the client portal activation email (email only; WhatsApp out of scope). Gated by the same pure preview service that renders "what would be sent" (`GET .../notification-preview`); **at-most-once** via an atomic claim on `lead_cases.activation_email_sent_at` (claim rolled back on provider failure so retry is possible). Outcomes audited (`email_activation_sent`/`blocked`/`failed`); already-sent ⇒ 409. UI: Client Portal card on lead detail shows the "Email sent" state.
- Still absent: any client login/credentials — portal access itself remains a future phase.

## Q. Referral tunnel (consent → matched partner hand-off)

1. Lead gives explicit POPIA consent (lead row locked FOR UPDATE).
2. Funnel calls EMA `POST /api/referrals/match` (signed, non-PII). EMA is the sole matcher.
3. Match ⇒ store `ema_firm_id`, audit `offered`, fire-and-forget redacted offer email to the firm admin with EMA's signed `acceptUrl`. No match / EMA down ⇒ honest unmatched, **no email**.
4. Firm views `/referral-preview/:referralId` (flips offered→preview_viewed), accepts inside EMA.
5. EMA fires the signed `converted` callback — terminal, idempotent.
- **PII invariant:** referrals table structurally holds no applicant PII; acceptUrl never persisted; fail-closed 503 without secret.

## R. Blocked / partial / placeholder flows (honest inventory)

| Flow | State |
|---|---|
| Lifecycle automations | **Scaffold only** — rules seeded disabled, read-only API, no worker, no side effects. |
| Client portal access | Status machine + activation email are live, but **no client login/credentials exist yet** — actual portal access is a future phase. |
| Admin analytics/reports/support/pipelines pages | **Stubs** (`admin-stub.tsx`) — navigation chrome only. |
| `POST /admin/email/update` | Legacy, superseded by campaigns. |
| `partner_firms` table | No longer the referral-matching source (EMA match API is authoritative), though its admin CRUD routes remain live. |
| Demo booking | Not implemented (test skipped). |
| EMA firm-contact lookup endpoint | Not implemented on EMA side; offer email relies on `firmContactEmail` in the match response. |
| Known defects | DEF-001 (invalid email accepted), DEF-002 (invalid WhatsApp silently dropped) — encoded as `test.fail` expectations. |
