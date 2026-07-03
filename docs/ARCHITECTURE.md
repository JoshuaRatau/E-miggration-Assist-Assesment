# E-Migration Assist — Architecture Document (A→Z)

> A complete reference to the system: how it is deployed, how the code is
> organised, every API endpoint, every backend library function, the database
> schema, the frontend, the background workers, the security model, and the
> external integrations.
>
> Companion doc: `replit.md` holds the newest-first log of *why* each decision
> was made. This document describes *what exists now*.

---

## 1. Executive summary

E-Migration Assist is a pre-launch immigration platform for the South African
market. It has two faces:

1. **Public assessment funnels** — travellers, overstay/undesirable cases, and
   firms/professionals complete a structured multi-step questionnaire. Each
   submission becomes a *lead* with a reference number, optional document
   uploads, and an email/WhatsApp confirmation.
2. **Admin CRM** — an authenticated back office for lead management, a Kanban
   pipeline, lead scoring, email/WhatsApp campaigns, templates, CSV import,
   lifecycle automations, billing reconciliation, and reporting.

It is a **pnpm monorepo** with a contract-first API (OpenAPI → generated client
hooks + Zod schemas), an Express + Drizzle + PostgreSQL backend with a pg-boss
durable job queue, and a React + Vite frontend.

---

## 2. Deployment topology (live)

Split deploy — frontend on Vercel, backend + Postgres + queue on Replit, a
marketing site reverse-proxies the app under `/assessment/`.

```
Browser → www.emigration-assist.com/assessment/*   (marketing site, separate Vercel project)
              │  rewrite (path-stripped)
              ▼
          <assessment>.vercel.app/*                 (this repo's Vite SPA build)
              │  XHR / fetch with credentials
              ▼
          immigrationassist.replit.app/api/*        (this repo's Express + pg-boss + Postgres)
```

### Two-backend gotcha (critical)

This Repl's own deployment serves at `https://e-migrationassist.com` and
`https://immigrationassist.replit.app` — both run the **current committed code**.

The Vercel frontend resolves its API base from `VITE_API_URL`. In at least one
incident it pointed at `https://api.emigration-assist.com` — a **separate, older
backend with its own database** that is NOT updated when you publish from here.
Symptom: a feature "works on `*.replit.app` but 404s / behaves differently on
the live site." First step when diagnosing: probe both backends; if they
disagree it is a wrong-backend problem, not a code bug.

### Runtime target

`.replit` currently sets `deploymentTarget = "autoscale"`, but the backend runs
pg-boss plus always-on single-replica workers (score worker, campaign
scheduler). Autoscale suspends idle instances and drops pg-boss's long-lived DB
connections. The correct target for this app is a **Reserved VM** (always-on).

---

## 3. Monorepo layout

```
artifacts/                       # Deployable applications
  api-server/                    # Express backend  (@workspace/api-server)
  emigration-assist/             # React + Vite SPA (@workspace/emigration-assist)
  mockup-sandbox/                # Canvas component-preview server
lib/                             # Shared libraries
  api-spec/                      # OpenAPI source of truth (@workspace/api-spec)
  api-client-react/              # Generated React Query hooks (@workspace/api-client-react)
  api-zod/                       # Generated Zod schemas (@workspace/api-zod)
  db/                            # Drizzle schema + client (@workspace/db)
scripts/                         # Shared utility scripts (@workspace/scripts)
```

- `lib/*` packages are **composite** (emit declarations via `tsc --build`).
- `artifacts/*` and `scripts` are **leaf** packages (`tsc --noEmit`); they never
  import each other — shared code goes into a `lib/*` package.

### Commands

`pnpm install` · `pnpm dev` · `pnpm build` · `pnpm typecheck` ·
`pnpm orval` (codegen) · `pnpm db:push` (schema push).

---

## 4. Tech stack

| Layer      | Technology |
|------------|------------|
| Runtime    | Node 24, TypeScript 5.9 |
| Backend    | Express 5, Drizzle ORM, Zod, esbuild bundle |
| Queue      | pg-boss v12 (durable, Postgres-backed) |
| Database   | PostgreSQL |
| Frontend   | React, Vite 7, Wouter (routing), TanStack Query, Tailwind, shadcn/ui, TipTap, Recharts |
| Contract   | OpenAPI (`lib/api-spec`) → Orval codegen → hooks + Zod |
| Email      | Resend (Replit connector or env key) / SMTP fallback in prod |
| WhatsApp   | Twilio + Meta WhatsApp Cloud API |
| Storage    | Replit App Storage / S3 (object storage) |
| Logging    | pino / pino-http |

---

## 5. Request lifecycle & middleware

`artifacts/api-server/src/app.ts` composes the Express app; everything is
mounted under `/api`:

1. **`pino-http`** — structured request logging. Request serializer strips query
   strings from the logged URL (PII hygiene); response serializer logs status
   only.
2. **CORS** — `WEB_ORIGIN` (comma-separated allow-list) drives the allowed
   origins; unset falls back to reflecting the request origin (frictionless
   dev). `credentials: true` so cookies traverse cross-site. **Fail-closed:**
   in production, `CROSS_SITE_COOKIES=true` with no `WEB_ORIGIN` refuses to
   boot.
3. **`cookie-parser`** — reads the `ema_admin_session` cookie.
4. **`trust proxy`** — honours the Replit reverse proxy so `req.ip` /
   `req.protocol` reflect the real client (needed for webhook signature URL
   reconstruction).
5. **`express.json`** — captures `rawBody` (kept for future raw-body-signing
   webhooks) + **`express.urlencoded`** (Twilio posts form-encoded).
6. **Router** — `app.use("/api", router)` mounts all routers listed in §6.

`artifacts/api-server/src/index.ts` is the process entry: it starts the HTTP
listener, then fires the bootstrap + worker startup (§8), and wires
SIGTERM/SIGINT graceful shutdown.

---

## 6. Backend — API surface

All routers are mounted in `artifacts/api-server/src/routes/index.ts` under the
`/api` prefix. Endpoints below are grouped by domain. **Admin-gated** = requires
a valid admin session cookie (or legacy `x-admin-token`); **superadmin** =
requires `is_superadmin`.

### 6.1 Health & analytics
| Method | Path | Notes |
|---|---|---|
| GET  | `/api/healthz` | Liveness probe |
| POST | `/api/analytics/events` | Client analytics ingest |

### 6.2 Public assessment / leads
| Method | Path | Notes |
|---|---|---|
| POST | `/api/leads` | Create lead (rate-limited, honeypot, two-phase) |
| POST | `/api/leads/:id/finalize` | At-most-once confirmation dispatch |
| GET  | `/api/leads` | Slim admin list (`?archived=` toggle) |
| GET  | `/api/leads/export.csv` | CSV export |
| GET  | `/api/leads/by-id/:id` | Full lead by id (admin) |
| GET  | `/api/leads/:referenceNumber` | Lookup by reference |
| POST | `/api/overstay-intake` | Overstay/undesirable funnel |
| POST | `/api/business-intake` | Firm/professional funnel |
| POST | `/api/support` | Support-widget submission (+ Eride Hub mirror) |

### 6.3 OTP & documents
| Method | Path | Notes |
|---|---|---|
| POST | `/api/otp/request` | Send OTP (WhatsApp → email fallback) |
| POST | `/api/otp/verify` | Verify OTP |
| GET  | `/api/documents` | Session-scoped document list |
| DELETE | `/api/documents/:id` | Delete a document |
| GET  | `/api/documents/:id/download` | Signed download |

### 6.4 Public status
| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/status/:referenceNumber` | PII-minimised status lookup |

### 6.5 Admin — auth & users
| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/auth/login` | Mint session cookie |
| POST | `/api/admin/auth/logout` | Destroy session |
| GET  | `/api/admin/auth/me` | Current admin |
| POST | `/api/admin/auth/change-password` | Self-service change |
| POST | `/api/admin/auth/forgot` | Mint 1-hour reset token, email link (always 200) |
| POST | `/api/admin/auth/reset` | Consume reset token |
| GET/POST | `/api/admin/users` | List / create (superadmin) |
| PATCH/DELETE | `/api/admin/users/:id` | Update / hard-delete (superadmin) |
| POST | `/api/admin/users/:id/reset` | Mint temp password (superadmin) |

### 6.6 Admin — leads, cases, engagement
| Method | Path | Notes |
|---|---|---|
| PATCH | `/api/admin/leads/:id` | Update (status/tier/SLA/assignment) |
| POST | `/api/admin/leads/:id/archive` · `/unarchive` | Soft archive (idempotent) |
| DELETE | `/api/admin/leads/:id` | Permanent delete (atomic, 409 if linked case) |
| GET | `/api/admin/leads/:id/events` | Score-event stream + meta |
| GET | `/api/admin/leads/:id/timeline` | Unified activity timeline |
| GET | `/api/admin/leads/:id/messages` | Case messages |
| GET/POST | `/api/admin/leads/:id/engagements` · `/send-update` | Engagements + manual update |
| GET/PATCH | `/api/admin/cases/:caseId` | Case detail / advance (forward-only) |
| POST | `/api/admin/audit` | Frontend-only audit events (allow-list) |
| POST | `/api/admin/email/update` | Ad-hoc admin email |

### 6.7 Admin — campaigns & templates
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/campaigns` · `/stats` | List / aggregate stats |
| POST | `/api/admin/campaigns` | Create draft (HTML sanitised) |
| GET/PATCH/DELETE | `/api/admin/campaigns/:id` | Read / edit draft|scheduled / delete draft |
| POST | `/api/admin/campaigns/:id/preview` · `/test` | Render preview / send test |
| POST | `/api/admin/campaigns/:id/send` | Atomic claim → queue (202, 2000 cap) |
| POST | `/api/admin/campaigns/:id/schedule` · `/unschedule` | Scheduled send |
| POST | `/api/admin/campaigns/:id/pause` · `/resume` | Pause / resume |
| GET/POST | `/api/admin/templates` | List / create |
| GET/PATCH | `/api/admin/templates/:id` | Read / update (archived immutable) |
| POST | `/api/admin/templates/:id/archive` · `/unarchive` · `/preview` | Lifecycle + preview |
| POST | `/api/admin/templates/seed-defaults` | Seed starter templates |

### 6.8 Admin — imports, lifecycle, uploads
| Method | Path | Notes |
|---|---|---|
| POST/GET | `/api/admin/imports` | Create job / list |
| POST | `/api/admin/imports/:id/mapping` · `/commit` | Column mapping / commit |
| GET | `/api/admin/imports/:id` · `/errors.csv` | Job detail / error report |
| GET | `/api/admin/lifecycle/rules` · `/:id` · `/:id/executions` | Read-only automations |
| GET | `/api/public-assets/{*splat}` | Public asset proxy |

### 6.9 Stats
| Method | Path | Notes |
|---|---|---|
| GET | `/api/stats/summary` · `/lead-mix` · `/source-mix` | Dashboard aggregates |
| GET | `/api/stats/source-attribution` | Attribution panel (range + segment) |

### 6.10 Webhooks & unsubscribe
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/unsubscribe` | RFC-8058 one-click unsubscribe |
| POST | `/api/webhooks/whatsapp` | Twilio/Meta inbound (signature fail-closed) |
| POST | `/api/webhooks/emigration-billing` | Billing events (HMAC-verified) |

---

## 7. Backend — library modules & functions

Located in `artifacts/api-server/src/lib/`. Each entry lists the exported
functions.

### Auth & session
- **`adminAuth.ts`** — `requireAdminAuth`, `requireAdminToken` (route guards; cookie-first, legacy token fallback).
- **`adminSession.ts`** — `createSession`, `deleteSession`, `loadSessionUser`, `readSessionCookie`, `setSessionCookie`, `clearSessionCookie`, `purgeExpiredSessions`, `tokenHash`, `SESSION_COOKIE`, `SESSION_TTL_MS`.
- **`adminPassword.ts`** — `hashPassword`, `verifyPassword`, `validatePasswordPolicy` (bcrypt cost 12; policy: ≥10 chars, letter + digit).
- **`adminBootstrap.ts`** — `bootstrapAdminAccounts` (seeds demo superadmin if table empty, purges expired sessions).

### Leads, scoring, classification
- **`classification.ts`** — `generateReferenceNumber`, `classifyCase`, `deriveAutoPriority`, `deriveNextStep`, `canAdvanceStatus`, plus canonical enums (`LEAD_STATUS_VALUES`, `LEAD_TYPE_VALUES`, `LEAD_PRIORITY_VALUES`, `INQUIRY_TYPE_VALUES`, `ORGANIZATION_TYPE_VALUES`, `ADMIN_ROLE_VALUES`).
- **`recordLeadEvent.ts`** — `recordLeadEvent` (canonical fire-and-forget event writer).
- **`scoringRubrics.ts`** — `getRubric`, `pickRubricForTier`, `pointsFor` (3 rubrics: self_serve / sales / static).
- **`scoreCompute.ts`** — `computeScore` (pure recompute from event stream).
- **`scoreWorker.ts`** — `startScoreWorker`, `stopScoreWorker`, `recomputeOne`, `backfillIfNeeded` (60s single-replica tick).
- **`cases.ts`** — `ensureCaseForLead`, `touchCaseUpdatedAt`.
- **`caseStatus.ts`** — `canAdvanceCaseStatus`, `CASE_STATUS_VALUES` (forward-only).

### Messaging, email, WhatsApp
- **`messaging.ts`** — `sendMessage` (channel-agnostic gateway; owns engagement-row lifecycle).
- **`email.ts`** — `sendConfirmationEmail`, `sendUpdateEmail`, `sendCustomEmail`, `sendInternalNotificationEmail`, `composeConfirmationBody`, `findForbiddenPhrase` (canonical sender = `noreply@emigration-assist.com`; SMTP prod path + Resend fallback; forbidden-phrase screen).
- **`confirmation.ts`** — `buildConfirmationDispatcher`.
- **`whatsapp.ts`** — `normalizeWhatsapp` (E.164 canonicalisation).
- **`whatsappClient.ts`** — `isWhatsAppConfigured`, `sendWhatsAppText`, `sendWhatsAppOtp`.
- **`whatsappCampaign.ts`** — `isInWhatsAppWindow`, `decideWaSend`, `executeWaDecision`, `WA_24H_MS` (24h-window logic).
- **`whatsappWebhook.ts`** — `verifyTwilioSignature`, `extractInboundMessage`, `detectIntent`.
- **`otp.ts`** — `generateOtpCode`, `hashOtpCode`, `findUsableVerifiedOtp`, `safeEqualHex`, `OTP_TTL_MS`, `OTP_MAX_ATTEMPTS`, `OTP_VERIFICATION_WINDOW_MS`.

### Campaigns
- **`audienceQuery.ts`** — `compileAudience`, `AudienceQuerySchema`, `AudienceRuleSchema`, `AUDIENCE_FIELDS`, `AUDIENCE_OPS` (zod-validated AND/OR compiler over a 12-field whitelist).
- **`campaignRender.ts`** — `renderTemplate`, `leadToContext`, `findUnknownTokens`, `TEMPLATE_TOKENS` (4 merge tokens).
- **`htmlSanitize.ts`** — `sanitizeEmailHtml` (DOMPurify; runs on save + render).
- **`campaignDispatch.ts`** — `dispatchClaimedCampaign`, `MAX_RECIPIENTS_PER_CAMPAIGN` (shared compile→snapshot→materialise→enqueue path).
- **`campaignSendWorker.ts`** — `handleCampaignSendJob`, `maybeFinaliseCampaign` (per-recipient worker; atomic finaliser).
- **`campaignScheduleWorker.ts`** — `startCampaignScheduleWorker`, `stopCampaignScheduleWorker` (30s tick, queue-ready gate).
- **`unsubscribe.ts`** — `mintUnsubscribeToken`, `verifyUnsubscribeToken`, `buildUnsubscribeUrl`, `recordUnsubscribe`, `isUnsubscribed`, `findUnsubscribed`, `canonicalContact` (HMAC-signed tokens).

### Queue & infrastructure
- **`queue.ts`** — `startQueue`, `stopQueue`, `getQueue`, `isQueueReady`, `enqueueCampaignSends`, `QUEUE_CAMPAIGN_SEND` (pg-boss boot, single named queue).
- **`rateLimit.ts`** — `createRateBucket` (sliding-window limiter).
- **`audit.ts`** — `writeAudit`, `actorTokenHash` (append-only audit; actor hashed).
- **`logger.ts`** — `logger` (pino singleton).

### Object storage & ACL
- **`objectStorage.ts`** — `objectStorageClient`.
- **`objectAcl.ts`** — `getObjectAclPolicy`, `setObjectAclPolicy`, `canAccessObject`.

### Billing
- **`billingIngest.ts`** — `verifyEmigrationSignature`, `reserveIngestEvent`, `finaliseIngestEvent`, `dispatchBillingEvent`, `correlateLead`, `recordPayment`, `upsertSubscription`, `autoConvertLeadOnFirstPayment`, `recordUnmatched` (idempotent HMAC-verified ingest).

### Bootstrap / seed
- **`templateBootstrap.ts`** — `bootstrapCommTemplates`; **`seedCommTemplates.ts`** — `SEED_COMM_TEMPLATES` (20 seed templates).
- **`lifecycleBootstrap.ts`** — `bootstrapLifecycleRules` (3 disabled starter rules).
- **`supportHub.ts`** — `forwardSupportTicketToHub` (mirror to external Eride Support Hub).
- **`imports/`** — CSV import parsing/mapping/commit helpers.

---

## 8. Background workers & bootstrap

Started fire-and-forget from `index.ts` after the HTTP listener binds; each
error is logged, never crashes the process:

1. **`bootstrapAdminAccounts()`** — seed demo superadmin (if empty) + purge expired sessions.
2. **`bootstrapCommTemplates()`** — seed 20 comm templates (`onConflictDoNothing`).
3. **`bootstrapLifecycleRules()`** — seed 3 disabled lifecycle rules.
4. **`startScoreWorker()`** — 60s tick, 200/batch transactional score recompute.
5. **`startQueue()`** — pg-boss `campaign-recipient-send` queue (`batchSize:8`, 1s poll); auto-creates `pgboss.*` tables.
6. **`startCampaignScheduleWorker()`** — 30s tick; claims due scheduled campaigns via atomic `UPDATE … RETURNING`.

**Graceful shutdown:** SIGTERM/SIGINT → stop schedule worker → `stopQueue()`
(10s timeout).

---

## 9. Database schema

Drizzle schema in `lib/db/src/schema/` (one file per domain). Push with
`pnpm db:push`.

### `leads.ts`
- **`prelaunch_leads`** — the central lead record. Columns: `id`,
  `referenceNumber`, `fullName`, `email`, `whatsapp`, `nationality`,
  `countryOfResidence`, `currentlyInSouthAfrica`, `passportStatus`,
  `visaHistory`, `immigrationSituation`, `visaExpiryDate`, `exitDate`,
  `borderDocumentIssued`, `overstayReason`, `hasSupportingDocuments`,
  `previousOverstay`, `internalClassification`, `leadScore`, `leadCategory`,
  `leadPriority`, `leadStatus`, `adminNotes`, `preferredContactMethod`,
  `consentAccepted`, `consentTimestamp`, `leadType`, `inquiryType`, `source`,
  `sourceCampaign`, `assignedTo`, `lastContactedAt`, `nextFollowUpAt`, `tags`,
  `organizationName`, `organizationType`, `representativeName`,
  `representativeEmail`, `representativePhone`, `intendedTier`,
  `leadScoreRubric`, `leadScoreBreakdown`, `leadScoreComputedAt`,
  `representativeRole`, `representativeRelationship`, `website`, `firmSize`,
  `operatingRegions`, `serviceFocus`, `estimatedClientVolume`,
  `slaEmailDueAt` / `slaWhatsappDueAt` / `slaPhoneDueAt`, `archivedAt`,
  `createdAt`, `updatedAt`.
- **`prelaunch_documents`** — uploaded document metadata (session-scoped listing).
- **`analytics_events`** — client analytics.
- **`lead_engagements`** — outbound touch log (confirmations, updates).
- **`case_messages`** — inbound/outbound WhatsApp/case messages.
- **`lead_otps`** — OTP challenge records (hashed codes).
- **`lead_audit`** — append-only privileged-action audit (hashed actor).
- **`lead_events`** — append-only scoring event stream (points snapshotted).

### `leadCases.ts`
- **`lead_cases`** — `id`, `leadId`, `referenceNumber`, `status`, `createdAt`, `updatedAt` (forward-only status; created on convert).

### `admin.ts`
- **`admin_users`** — email + bcrypt hash, `role`, `isSuperadmin`, `isActive`, timestamps.
- **`admin_sessions`** — opaque server-side sessions (7-day TTL).
- **`admin_password_resets`** — sha256-hashed single-use tokens (1-hour).

### `campaigns.ts`
- **`campaigns`** — draft→scheduled→sending→paused→completed/cancelled; counters, `scheduledAt`.
- **`campaign_recipients`** — per-recipient send state (queued→sending→sent/failed/skipped).
- **`unsubscribes`** — `(channel, contact)` opt-outs.

### `templates.ts`
- **`comm_templates`** — reusable email/WhatsApp templates (category, channel-locked, soft-delete).

### `lifecycle.ts`
- **`lifecycle_rules`** — declarative "if event then action" rules (all seeded disabled).
- **`lifecycle_executions`** — execution audit + idempotency (`UNIQUE(rule_id, lead_id, triggered_by)`).

### `imports.ts`
- **`import_jobs`** / **`import_job_rows`** — CSV import staging + per-row status.

### `billing.ts`
- **`billing_subscriptions`**, **`billing_payments`**, **`billing_ingest_events`** (idempotency), **`billing_unmatched`** (uncorrelated events).

### `support.ts`
- **`support_requests`** — support-widget submissions + Eride Hub sync columns (`hubTicketReference`, `hubSyncedAt`).

---

## 10. Frontend — React + Vite SPA

`artifacts/emigration-assist/`. Routing via **Wouter**; server state via
**TanStack Query**; Vite `base` defaults to `/assessment/` in prod (overridable
by `BASE_PATH` in dev).

### Pages (`src/pages/`)
- **Public:** `home.tsx`, `assessment.tsx` (traveller funnel),
  `overstay-assessment.tsx`, `business-assessment.tsx` (firm funnel),
  `pricing.tsx`, `status.tsx`, `thank-you.tsx`, `not-found.tsx`.
- **Admin:** `admin-login.tsx`, `admin-forgot.tsx`, `admin-reset.tsx`,
  `admin.tsx` (dashboard/leads), `admin-lead-detail.tsx`,
  `admin-case-detail.tsx`, `admin-communications.tsx`,
  `admin-campaign-editor.tsx`, `admin-campaign-detail.tsx`,
  `admin-import.tsx`, `admin-exports.tsx`, `admin-users.tsx`,
  `admin-profile.tsx`, `admin-subscriptions.tsx`, `admin-stub.tsx`.

### Key components (`src/components/`)
- **Chrome:** `admin-layout.tsx` (sole admin chrome; no sidebar),
  `admin-user-menu.tsx` (grouped nav), `brand-header.tsx`,
  `dashboard-greeting.tsx` (shared minute clock).
- **Leads / CRM:** `lead-pipeline-board.tsx` (Kanban), `lead-score-badge.tsx`,
  `lead-activity-panel.tsx`, `lead-activity-feed.tsx`,
  `lead-timeline-dialog.tsx`, `lead-velocity-chip.tsx`,
  `lead-source-badge.tsx`, `preferred-communication-cell.tsx`,
  `saved-views-bar.tsx`, `help-tooltip.tsx`.
- **Campaigns:** `audience-query-builder.tsx`, `CampaignBodyEditor` (TipTap),
  `admin-dashboard/` (source-performance card etc.).
- **Public:** `DocumentUploader.tsx`, `whatsapp-input.tsx`,
  `country-combobox.tsx`, `support-widget.tsx`, `legal-modals.tsx`,
  `disclaimer.tsx`, `landing/`.

### Frontend lib (`src/lib/`)
Mirrors of backend enums + helpers: `apiBase.ts` (API base resolution),
`adminAuth.tsx` / `adminToken.ts` (auth context), `leadStatus.ts`,
`leadScore.ts`, `leadSegment.ts`, `leadSource.ts`, `leadVelocity.ts`,
`intendedTier.ts`, `typeOfEnquiry.ts`, `caseStatus.ts`, `countries.ts`,
`b2bContactIntelligence.ts`, `preferredCommunication.ts`,
`personalisedNote.ts`, `savedViews.ts`, `analytics.ts`, `metaPixel.ts`,
`utils.ts`.

**API base resolution:** every call uses `${VITE_API_URL ?? BASE_URL}/api/...`.
On Vercel `VITE_API_URL` bypasses the `/assessment` prefix; on Replit dev it is
unset and same-origin `BASE_URL` is used.

---

## 11. Shared libraries (contract-first)

- **`@workspace/api-spec`** — OpenAPI YAML is the source of truth
  (`lib/api-spec/openapi.yaml`). `pnpm orval` / `pnpm --filter @workspace/api-spec run codegen` regenerates clients. Do **not** change `info.title` (drives generated filenames).
- **`@workspace/api-zod`** — generated Zod schemas for request/response validation.
- **`@workspace/api-client-react`** — generated React Query hooks; `customFetch` defaults to `credentials: "include"`.
- **`@workspace/db`** — Drizzle schema (`@workspace/db/schema`) + the `db` client.

> Note: several bespoke/admin endpoints (stats attribution, lead events,
> lifecycle, etc.) are intentionally **not** in the OpenAPI spec to avoid
> codegen churn; they are called with direct `fetch` + `useQuery`.

---

## 12. Security model

- **Admin auth:** email + password → opaque server-side session, httpOnly
  `ema_admin_session` cookie (7-day TTL, `SameSite=Lax`, `Secure` in prod;
  flips to `SameSite=None; Secure` when `CROSS_SITE_COOKIES=true`). Legacy
  `x-admin-token` still accepted as fallback.
- **Password reset:** 1-hour single-use sha256-hashed token, emailed link; the
  `/forgot` endpoint always returns 200 (no account-existence oracle).
- **Rate limiting:** `POST /api/leads` sliding window (10/IP, 5/email,
  5/canonical-WA) before parsing, plus `website` honeypot returning synthetic
  201.
- **Audit trail:** every privileged mutation writes a `lead_audit` row; actor
  credential is sha256-hashed (raw value never stored); `actor_user_id` links
  cookie-authed mutations to a real admin.
- **Webhook fail-closed:** WhatsApp webhook returns 503 if neither
  `WHATSAPP_APP_SECRET` nor `TWILIO_AUTH_TOKEN` is set; 401 on missing/invalid
  signature (nothing persisted). Billing webhook is HMAC-verified with an
  idempotency reservation.
- **CORS fail-closed:** production refuses to boot on
  `CROSS_SITE_COOKIES=true` with no `WEB_ORIGIN`.
- **Email safety:** forbidden-phrase screen blocks over-promising client-facing
  copy; server-side HTML sanitiser on all email bodies.
- **PII hygiene:** request logs strip query strings; recipient emails redacted
  in send logs; public status endpoints minimise disclosed info.

---

## 13. External integrations

| Integration | Purpose | Key env |
|---|---|---|
| **Resend** | All platform email (canonical sender `noreply@emigration-assist.com`; domain must be verified) | `RESEND_API_KEY`, `EMAIL_FROM` (or Replit connector) |
| **SMTP (prod)** | Optional production email path (e.g. Office 365) | `SMTP_HOST/PORT/USER/PASSWORD`, `EMAIL_FROM` |
| **Twilio WhatsApp** | OTP + campaign/case messaging | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TEMPLATE_SID` |
| **Meta WhatsApp Cloud** | Inbound webhook / send path | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| **Object storage (S3 / App Storage)** | Document uploads | `AWS_*`, `S3_BUCKET`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID` |
| **Eride Support Hub** | Mirror support tickets externally | `SUPPORT_HUB_URL`, `SUPPORT_HUB_PRODUCT_ID` |
| **Billing provider** | Payment/subscription webhook → auto-convert | `EMIGRATION_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY` |

---

## 14. Environment variables

**Required:** `DATABASE_URL`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` / `TWILIO_WHATSAPP_FROM`,
`OTP_SECRET`, object-storage vars.

**Cross-origin (split deploy):** `WEB_ORIGIN` (comma-separated),
`CROSS_SITE_COOKIES=true`, and on Vercel `VITE_API_URL=https://immigrationassist.replit.app`.

**Optional:** `ADMIN_EMAIL_TOKEN` (legacy header), `BOOTSTRAP_ADMIN_EMAIL/PASSWORD`,
`PUBLIC_BASE_URL` (reset/unsubscribe links; falls back to `$REPLIT_DEV_DOMAIN`),
`WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`, `UNSUBSCRIBE_SECRET`
(falls back to `SESSION_SECRET`; fails closed in prod if both unset).

---

## 15. Key data flows

### 15.1 Public assessment → lead
1. User completes the multi-step funnel (7 steps, 8 with supporting docs).
2. At the Terms step, `POST /api/leads` commits the row with `finalize:false`
   (reference generated server-side but **never shown in-flow**). Rate limits +
   honeypot run before parsing. A `lead_created` score event is recorded.
3. Optional document upload (session-scoped).
4. `POST /api/leads/:id/finalize` dispatches the confirmation (email/WhatsApp),
   **at-most-once** (skips if a confirmation engagement already exists), then
   the SPA redirects to `/thank-you/:reference` — the single reference-revealing
   surface.

### 15.2 Lead scoring (event-sourced)
`recordLeadEvent()` appends to `lead_events` at 4 sites (created, assessment
completed, status advanced, tier set). The 60s `scoreWorker` recomputes scores
per rubric and writes score-meta back to `prelaunch_leads`. The UI badge prefers
worker values and falls back to a legacy heuristic for unprocessed leads.

### 15.3 Campaign send (queued)
`POST /send` atomically claims the campaign `draft→sending` (concurrent click →
409), then `dispatchClaimedCampaign` compiles the audience, snapshots
recipients (2000 cap), pre-settles unsubscribes, and enqueues pg-boss jobs;
returns **202**. The per-recipient worker claims `queued→sending`, dispatches,
and settles `sent/failed/skipped` with race-safe counter bumps. An atomic
finaliser flips the campaign to `completed`. Scheduling, pause, and resume are
layered on the same dispatch path.

### 15.4 Billing → auto-convert
`POST /api/webhooks/emigration-billing` verifies the HMAC signature, reserves an
idempotency row, correlates the event to a lead, records the payment / upserts
the subscription, and auto-converts the lead to a case on first payment;
uncorrelated events land in `billing_unmatched`.

---

*Generated from a full scan of the codebase. For the rationale behind each
decision, see the "Architecture decisions" section of `replit.md`.*
