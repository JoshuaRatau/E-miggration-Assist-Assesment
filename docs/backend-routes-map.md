# Backend API Routes Map (`artifacts/api-server`, Express 5, mounted at `/api`)

Auth legend: **Public** (rate-limited where noted) · **Admin** = `requireAdminAuth`/`requireAdminToken` (session cookie first, legacy `x-admin-token` fallback) · **Super** = superadmin only · **Signed** = cryptographic verification. "OpenAPI" = defined in `lib/api-spec/openapi.yaml` (bespoke routes are deliberately excluded to avoid codegen churn).

## Public funnel

| Method | Path | Purpose | Auth | OpenAPI | Tables |
|---|---|---|---|---|---|
| GET | `/healthz` | Health check | Public | ✔ | — |
| POST | `/leads` | Submit assessment (two-phase; `finalize` flag; honeypot `website` field → synthetic 201) | Public, rate-limited | ✔ | prelaunch_leads, analytics_events |
| POST | `/leads/:id/finalize` | Fire at-most-once confirmation (email/WA) | Public (UUID) | ✘ | prelaunch_leads, lead_engagements |
| GET | `/leads/:referenceNumber` | Public lead lookup (thank-you page) | Public, rate-limited | ✔ | prelaunch_leads |
| GET | `/public/status/:referenceNumber` | Neutral public status view (status page) | Public, rate-limited | ✔ | prelaunch_leads, prelaunch_documents |
| POST | `/otp/request` / `/otp/verify` | OTP issue/verify (WhatsApp first, email fallback) | Public | ✘ | lead_otps |
| POST | `/overstay-intake` | Overstay segment questionnaire | Public, rate-limited | ✘ | prelaunch_leads |
| POST | `/business-intake` | B2B segment questionnaire | Public, rate-limited | ✘ | prelaunch_leads, lead_engagements |
| POST | `/analytics/events` | Funnel analytics event (allow-listed) | Public | ✔ | analytics_events |
| GET | `/documents` · POST `/documents/upload` · GET `/documents/:id/download` · DELETE `/documents/:id` (leadId-scoped) | Session-scoped document handling (server-side type allow-list) | Public (by leadId) | partial | prelaunch_documents, lead_audit |
| POST | `/support` | Support-widget submission (mirrored to external hub) | Public, rate-limited | ✘ | support_requests |
| GET/POST | `/unsubscribe` | RFC-8058 one-click unsubscribe (HMAC token) | Signed token | ✘ | unsubscribes |

## Admin CRM

| Method | Path | Purpose | Auth | OpenAPI | Tables |
|---|---|---|---|---|---|
| GET | `/leads` | Slim lead list (excludes archived by default; omits adminNotes; 50-row cap) | Admin | ✔ | prelaunch_leads, lead_cases |
| GET | `/leads/export.csv` | CSV export | Admin | ✘ | prelaunch_leads |
| GET | `/leads/by-id/:id` | Full lead detail | Admin | ✔ | prelaunch_leads (+case join) |
| PATCH | `/admin/leads/:id` | Status/owner/follow-up/notes-blob updates; `converted` gate + case creation in same PATCH | Admin | ✘ | prelaunch_leads, lead_cases, lead_audit, lead_events |
| POST | `/admin/leads/:id/notes` | Append-only internal note (awaited insert; 500 on failure) | Admin | ✘ | lead_audit |
| POST | `/admin/leads/:id/convert` | Explicit lead→case conversion (idempotent) | Admin | ✘ | lead_cases, lead_audit |
| POST | `/admin/leads/:id/prepare-portal` / `/activate-portal` | Portal state machine (see business rules) | Admin | ✘ | lead_cases, lead_audit |
| POST | `/admin/leads/:id/send-activation-email` | Portal activation email — at-most-once (atomic claim on `activation_email_sent_at`, rolled back on provider failure); 409 already-sent | Admin | ✘ | lead_cases, lead_audit |
| POST | `/admin/leads/:id/follow-up/complete` | Complete a follow-up (stamps lastContactedAt) | Admin | ✘ | prelaunch_leads, lead_audit |
| POST | `/admin/leads/:id/archive` · `/unarchive` · DELETE `/admin/leads/:id` | Soft-archive / restore / atomic delete (409 if linked case) | Admin | ✘ | prelaunch_leads (+cascade) |
| GET | `/admin/leads/:id/timeline` | Activity feed (audit + engagements) | Admin | ✘ | lead_audit, lead_engagements |
| GET | `/admin/leads/:id/engagements` / `/messages` / `/events` / `/notes` / `/notification-preview` | Outbound history / inbound WhatsApp / scoring events / notes / preview | Admin | ✘ | lead_engagements, case_messages, lead_events, lead_audit |
| POST | `/admin/leads/:id/send-update` | 1-to-1 email/WhatsApp send | Admin | ✘ | lead_engagements, lead_audit |
| GET | `/admin/assignable-users` | Ownership roster | Admin | ✘ | admin_users |
| POST | `/admin/audit` | Client-initiated audit log entry | Admin | ✘ | lead_audit |
| GET/PATCH | `/admin/cases/:id` | Case detail / forward-only status advance (409 on regression) | Admin | ✘ | lead_cases, lead_audit |
| GET | `/stats/summary` | Aggregate KPIs — ⚠️ **PUBLIC** (used by the landing page; deliberately unauthenticated, aggregate-only) | Public | ✔ | prelaunch_leads |
| GET | `/stats/lead-mix`, `/stats/source-mix` | Dashboard breakdowns | Admin | ✔ | prelaunch_leads |
| GET | `/stats/source-attribution` | Attribution panel (allow-list validated inputs) | Admin | ✘ | prelaunch_leads |
| GET/POST | `/admin/imports(/:id)` + `/:id/mapping` · `/:id/commit` · `/:id/errors.csv` | CSV/XLSX import pipeline (upload → map → commit) | Admin | ✘ | import_jobs, import_job_rows |
| GET | `/admin/referrals(/:referralId)` | Referral tracking views (non-PII rows) | Admin | ✘ | referrals, referral_audit |
| GET/POST | `/admin/partner-firms` | Legacy local firm directory CRUD (matching itself now done by EMA) | Admin | ✘ | partner_firms |
| POST | `/admin/uploads/image` · GET `/public-assets/*` | Campaign inline images | Admin / Public | ✘ | object storage |

## Campaigns & templates

| Method | Path | Purpose | Auth | OpenAPI |
|---|---|---|---|---|
| GET/POST/PATCH/DELETE | `/admin/campaigns(/:id)` | Campaign CRUD (editable until claimed) | Admin | ✔ |
| POST | `/admin/campaigns/:id/preview` | Merge-token render preview | Admin | ✔ |
| POST | `/admin/campaigns/:id/send` · `/test` | Queue-backed send (returns **202**, poll counters) / test send | Admin | ✔ |
| POST | `/admin/campaigns/:id/schedule` · `/unschedule` · `/pause` · `/resume` | Scheduling (audience re-evaluated at fire time; pause is best-effort) | Admin | ✔ |
| GET | `/admin/campaigns/stats` | Campaign aggregate stats | Admin | ✘ |
| GET/POST/PATCH | `/admin/templates(/:id)` + `/:id/preview` · `/:id/archive` · `/:id/unarchive` · `/seed-defaults` | Reusable comm templates (channel locked after create; archived rows immutable) | Admin | ✘ |
| GET | `/admin/lifecycle/*` | **Read-only** automation scaffold (no mutations exist) | Admin | ✘ |

## Auth & system

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/admin/auth/login` / `logout` · GET `/admin/auth/me` | Session lifecycle (httpOnly cookie, 7-day TTL) | Public / cookie |
| POST | `/admin/auth/forgot` / `reset` / `change-password` | Password reset (1-hour hashed single-use token) / self-service change | Public / cookie |
| GET/POST/PATCH/DELETE | `/admin/users(/:id)` + POST `/admin/users/:id/reset` | Admin management with self-protection; admin-initiated reset | **Super** |

## Webhooks & referral tunnel (all signed, all fail-closed)

| Method | Path | Purpose | Verification |
|---|---|---|---|
| POST | `/webhooks/whatsapp` | Inbound Twilio WhatsApp | Twilio HMAC-SHA1 signature; 503 if unconfigured |
| POST | `/webhooks/emigration-billing` | Revenue mirror pushed by main EMA | HMAC (`EMIGRATION_WEBHOOK_SECRET`) |
| POST | `/referrals/consent` | POPIA consent → EMA match call → referral row + offer email | consent-gated; lead row locked FOR UPDATE |
| GET | `/referrals/preview/:referralId` | Redacted public preview (flips offered→preview_viewed) | Public, non-identifying |
| GET | `/referral-gate/redirect/:referralId` | Signed redirect into EMA accept flow | HMAC token |
| POST | `/referral-gate/callback` | EMA convert callback (terminal, idempotent) | HMAC S2S (key-sorted body) |

**Flagged:** `POST /admin/email/update` (adminEmail.ts) is largely superseded by the campaign system — legacy, candidate for removal.
