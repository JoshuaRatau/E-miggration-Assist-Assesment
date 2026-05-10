# E-Migration Assist

E-Migration Assist helps users navigate the immigration process via a 5-step assessment, optional document uploads, and WhatsApp integration, paired with an admin CRM for lead management.

## Run & Operate

`pnpm install` / `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm orval` / `pnpm db:push`

**Required env:** `DATABASE_URL`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `OTP_SECRET`, `REPLIT_OBJECT_STORAGE_URL`.
**Optional:** `ADMIN_EMAIL_TOKEN` (legacy `x-admin-token`), `BOOTSTRAP_ADMIN_EMAIL`/`PASSWORD` (override seeded `demo@admin.local` / `ChangeMe!2026`), `PUBLIC_BASE_URL` (falls back to `https://$REPLIT_DEV_DOMAIN`; required for unsubscribe footer in email campaigns), `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` (preferred webhook signature path; falls back to `TWILIO_AUTH_TOKEN` HMAC), `UNSUBSCRIBE_SECRET` (HMAC; falls back to `SESSION_SECRET`; fails closed in prod if both unset).

## Stack

Express 5 + React, Node 24, TS 5.9, Drizzle, Zod, esbuild, PostgreSQL. pg-boss v12 for background jobs.

## Where things live

*   **API routes:** `artifacts/api-server/src/routes/`
*   **Backend lib:** `artifacts/api-server/src/lib/`
*   **DB schema:** `lib/db/src/schema/` (one file per domain: `leads`, `leadCases`, `admin`, `imports`, `campaigns`, `templates`)
*   **OpenAPI:** `lib/api-spec/openapi.yaml`
*   **Frontend:** `artifacts/emigration-assist/src/{pages,components,lib}/`, theme in `index.css`, country data in `lib/countries.ts`
*   **Roadmap:** `ROADMAP.md` (Phase 6A.5 → 6I plan)

## Architecture decisions

Listed newest-first. Older blocks are intentionally compressed; if a detail isn't here it's either obvious from the code or in `git log`.

### Phase 6F-4a — Lifecycle Automations (read-only scaffold)

Foundation for declarative "if event then action" rules. **Schema:** two narrow tables in `lib/db/src/schema/lifecycle.ts` — `lifecycle_rules` (name UNIQUE, `enabled bool default false`, `trigger_type` ∈ `lead_created|status_changed|sla_breached|time_since_event|tier_set`, `trigger_config jsonb`, `conditions jsonb` reusing audienceQuery 12-field whitelist shape, `action_type` ∈ `send_email_template|send_wa_template|notify_assignee_email|set_tag|advance_status`, `action_config jsonb`, `delay_minutes int`, soft-delete via `archived_at`, soft-ref `created_by/updated_by`) and `lifecycle_executions` (audit + idempotency: `UNIQUE(rule_id, lead_id, triggered_by)` makes duplicate event delivery a no-op insert, `status` ∈ `pending|completed|skipped|failed` with first-class `skip_reason`, indexes on `(status, scheduled_for)` for worker hot-path and `(lead_id, created_at)` for per-lead timeline). **Bootstrap:** `lib/lifecycleBootstrap.ts` seeds 3 starter rules **all `enabled=false`** (welcome drip 24h post-create, SLA breach alert, 14-day re-engagement tag) via atomic `onConflictDoNothing({target: name})` — concurrent boots cannot double-seed. Called fire-and-forget from `index.ts:55`. **API (read-only, NOT in OpenAPI):** `routes/adminLifecycle.ts` exposes `GET /api/admin/lifecycle/rules`, `GET /:id` (rule + last 10 executions), `GET /:id/executions?status=&limit=` — status filter fails closed with 400 on invalid value (no silent ignore). All admin-gated. **Frontend:** new "Automations" tab (5th) in `/admin/communications`, two-column read-only layout (rules table + detail card with trigger/conditions/action JSON + recent executions). Amber banner makes the read-only intent explicit. **No worker, no mutations, no side effects** — those land in 6F-4b (event-driven evaluator + first welcome drip), 6F-4c (5-min tick worker + SLA alert), 6F-4d (rule editor UI). Frontend mutation paths deliberately unwired so this phase cannot accidentally fire anything.

### Phase 6E — Source attribution intelligence

Dashboard's source-mix table replaced with a CRM-style attribution panel. **Backend:** new `GET /api/stats/source-attribution?range=7d|30d|1m|3m|6m|all&segment=all|b2c|b2b` in `routes/stats.ts` (admin-gated, **bespoke — NOT in OpenAPI** to avoid codegen churn). Returns `{rows, totals, series, insights, range, segment, bucket}`: rows include `leads`/`converted`/`conversionPct`/`growthPct` (period-over-period; `null` for new channels prev=0+leads>0, also `null` for `range=all`); `series` is daily/weekly/monthly buckets pivoted by source (bucket auto: 7d/30d/1m→day, 3m/6m→week, all→month); `insights` server-derived (top volume, top conv-rate ≥3 leads, fastest-grower >25%, decliner <-25%). All inputs allow-list-validated before any `sql.raw`. `range=all` short-circuits the correlated `prev_leads` subquery to `0::int`. Legacy `/stats/source-mix` route preserved for back-compat. **Frontend:** `components/source-performance-card.tsx` rebuilt — time-range pills, segment toggle (All/Travellers/Firms), Table↔Graph toggle, totals strip, recharts `ComposedChart` (smooth `Line` + gradient `Area` for top 6 sources, faint background lines for rest), insights panel, Growth% badges. Uses `useQuery` directly (30s `staleTime`). **V2 deferred:** zero-fill missing buckets server-side; avg qualification score / response time / pipeline progression columns.

### Phase 6D-3B — Scheduled send + pause/resume

Schema: `campaigns.scheduled_at timestamptz NULL`; status enum extended to `draft|scheduled|sending|paused|completed|cancelled` (text col, no DB enum). **Shared dispatch path** in `lib/campaignDispatch.ts → dispatchClaimedCampaign(campaign, log)` — caller does the atomic claim INTO `sending`; helper does audience-compile → snapshot → materialise (2000 cap) → pre-settle unsubscribes → enqueue, self-reverts to `draft` on early-exit (empty audience / missing body / no `PUBLIC_BASE_URL`) or self-cancels on materialise/enqueue failure. Used by both `POST /send` and the scheduler. **Scheduler** (`lib/campaignScheduleWorker.ts`): single-replica 30s tick, `isQueueReady()` gate (skips tick instead of burning the schedule), atomic `UPDATE … WHERE status='scheduled' AND scheduled_at<=now() RETURNING *` is the lock so `/unschedule` either wins or loses cleanly. System-actor audit rows written directly. **New routes** under `/api/admin/campaigns/:id`: `/schedule` (z.datetime body, 30s min / 90 days max), `/unschedule` (scheduled→draft, clears scheduledAt), `/pause` (sending→paused), `/resume` (paused→sending; re-enqueues every recipient still in `queued`; queue-readiness gate; calls `maybeFinaliseCampaign` afterwards as safety finaliser). **PATCH `/admin/campaigns/:id` accepts both `draft` and `scheduled`** so operators can edit until the scheduler claims; atomic UPDATE WHERE `status IN ('draft','scheduled')` makes a mid-claim PATCH 409 safely. **Worker pause check** (`campaignSendWorker.ts`): on pause, recipients are **reverted** `sending → queued` (UPDATE WHERE status='sending', race-defensive) — settling-as-skipped during pause was the v1 correctness bug since it terminally lost recipients. **Frontend:** editor adds Schedule-for-later button + datetime-local picker; detail page adds Pause / Resume / Cancel-schedule buttons (status-conditional), scheduled countdown banner (1-min tick), paused banner, status-pill colour map, 5s polling while status is `sending|paused|scheduled`. **Out of scope V2:** recurring/cron schedules, multi-replica leader election, in-flight pause.

### Phase 6D-3A — Background queue for campaign sends

Campaign sends moved from inline `for`-loop to a **pg-boss v12** queue. `lib/queue.ts` boots single named queue (`campaign-recipient-send`) on api-server (single-replica), `batchSize:8`, 1s polling; pg-boss schema (`pgboss.*`, 8 tables) auto-created on first start. **`POST /api/admin/campaigns/:id/send` returns 202** with `{campaign, queued, preSettled}`. **Recipient cap raised 200 → 2000.** Per-recipient worker (`lib/campaignSendWorker.ts`) does atomic `queued→sending` claim, dispatches via existing email/WA paths, settles to `sent`/`failed`/`skipped` and bumps campaign counters via `sql\`col + 1\`` (race-safe). Atomic finaliser uses `UPDATE … WHERE counters>=total` so exactly one worker flips campaign to `completed`. **Three hardenings:** (1) post-claim try/catch settles recipient as `failed` reason `worker_exception` — only a hard process kill leaves stuck `sending` rows; (2) `isQueueReady()` gate in send route returns 503 + leaves draft alone if queue isn't up (prevents draft being permanently buried as `cancelled`); (3) per-job try/catch in batch worker isolates bad jobs from siblings. SIGTERM/SIGINT graceful shutdown (10s timeout).

### Phase 6D-2 — Rich-text email composer

TipTap-based `components/CampaignBodyEditor.tsx` replaces the email-channel textarea: bold/italic/underline/strike, H1–H3, lists, blockquote, link (sanitised href), image upload via `/api/uploads`. WA channel keeps the textarea (must stay plain). **Server-side sanitiser** `lib/htmlSanitize.ts` (DOMPurify) runs on every email body in `POST /api/admin/campaigns` and `PATCH /:id` before persistence — strips `<script>`, event handlers, `javascript:` URLs, restricts to a tag/attr allow-list. Same sanitiser runs at render time in `lib/campaignRender.ts` (defence-in-depth). Stored as raw HTML; preview/test/send share render path.

### Phase 6D-1 — Per-channel SLA fields

`prelaunch_leads` gained `sla_email_due_at`, `sla_whatsapp_due_at`, `sla_phone_due_at` (nullable timestamps). Set/cleared via PATCH `/api/admin/leads/:id`; rendered as per-channel due-date pill in leads-table "Next Follow-up" column with overdue-amber / due-today-blue / on-track-grey states. Sort/filter by SLA-due is V2.

### Phase 6B — Tier-aware lead scoring (event-sourced)

Replaces synchronous `deriveLeadScore` heuristic with append-only `lead_events` stream + 60s recompute worker. **Schema:** `lead_events (id, lead_id, type, points, rubric, payload jsonb, source, occurred_at)` with `(lead_id, occurred_at)` idx; `prelaunch_leads` gained 3 nullable score-meta cols (`lead_score_rubric`, `lead_score_breakdown jsonb`, `lead_score_computed_at`). **Rubrics-in-code:** `lib/scoringRubrics.ts` defines 3 rubrics (`self_serve`/`sales`/`static`) routed by `pickRubricForTier(intendedTier)`. Each rule has `points`, optional `maxOccurrences`, optional `decayDays`. `pointsFor(rubric, type)` is **snapshotted into each event row** so historical contributions stay immutable. **Worker** (`lib/scoreWorker.ts`): in-process single-replica, 60s tick, 200/batch transactional backfill (`>=` dirty predicate eliminates restart drift). **API:** `serializeLead` exports the 3 score-meta fields; `GET /api/admin/leads/:id/events` returns events stream + score meta (NOT in OpenAPI). `recordLeadEvent({leadId, type, source, payload?})` is the canonical write helper (fire-and-forget, internal try/catch). **Wired at 4 sites:** `POST /api/leads` → `lead_created`, finalize → `assessment_completed` (after at-most-once guard), PATCH lead → `status_advanced` (forward only) and `tier_set` (set-to-non-null only, `maxOccurrences:1`). **Frontend:** `LeadScoreBadge` prefers worker values, falls back to legacy `deriveLeadScore` for unprocessed leads. `LeadActivityPanel` on `/admin/leads/:id` shows events stream + rubric snapshot. **V1 gap:** ~60s lag between PATCH and next worker tick may show stale score.

### Phase 6A.5 — Tier-aware lead intent

Nullable `prelaunch_leads.intended_tier text` capturing commercial-tier intent. 11 allowed values across 3 motions: B2C self-serve (`free`, `basic`, `plus`, `pro`, `premium`), B2B firm (`starter_firm`, `growth_firm`, `scale_firm`, `enterprise`), white-glove (`concierge`), plus `unknown`. Allow-list enforced at API layer. Source: `INTENDED_TIER_VALUES` in `routes/adminLeads.ts`; frontend mirror: `lib/intendedTier.ts`. Surfaced on slim list serializer, full Lead schema, audience-query builder, leads-table Name-cell pill, lead-detail dropdown. PATCH accepts explicit `null` to clear; tier changes write `lead_intended_tier_changed` audit row. **Public `POST /api/leads` insert path was not touched.** Foundational for 6B/6C/6D.

### Phase 6A.1 — Lead funnel trim (10 → 9 stages)

Dropped `awaiting_response` (duplicated `contacted` + `next_follow_up_at`). Touched canonical enum in `lib/classification.ts`, frontend `lib/leadStatus.ts`, kanban map, scoring weights, audience-query builder, both leads-table dropdowns, OpenAPI Lead schema, and `prelaunch_leads.lead_status` comment. Pre-existing `lead_audit` rows mentioning `awaiting_response` left untouched.

### Phase 6A — B2B Contact Intelligence

`PreferredCommunicationCell` hover-card renders B2B contact card for `leadType="professional"` rows: contact name, role/title, organisation, **relationship** (Primary Decision-Maker / Departmental / General Operations), **email-type** (Personal / Departmental / Generic). B2C rows keep masked-by-default address. **Schema:** `prelaunch_leads` gained `representative_role`, `representative_relationship` (nullable text); when NULL, fallbacks come from `lib/b2bContactIntelligence.ts` (role from `organizationType`; relationship inferred from email local-part — generic `info@`/`admin@`/`hr@` → General Ops; matches rep's name → Primary; else Departmental). Free-mail domains always personal. `AdminLeadListItem` extended with `representativeName/Email/Role/Relationship`, `firmSize`, `serviceFocus` (avoids N+1).

### Phase 5 — Executive Dashboard / CRM Operations (compressed)

*   **Data model:** `prelaunch_leads` gained `lead_type` (NOT NULL DEFAULT `individual`), `inquiry_type`, `source` (DEFAULT `web_form`), `assigned_to` (uuid soft-ref to `admin_users.id`, no FK), `last_contacted_at`, `next_follow_up_at`, `tags text[]`, plus 10 professional-lead cols (`organization_*`, `representative_*`, `website`, `firm_size`, `operating_regions`, `service_focus`, `estimated_client_volume`). `admin_users` gained `role` (`superadmin|admin|sales|operations|viewer`) coexisting with authoritative `is_superadmin` boolean. Status enum 7 → 10 (later 9 in 6A.1); priority gained `critical`. `AdminLeadListItem` (slim) and `PublicLead` (public-safe) codify smaller payloads.
*   **Communications hub:** `/admin/communications` four-tab shell (Campaigns / Templates / System Notifications [V1 placeholder] / Reports), tab from URL. Editor/detail at `/admin/communications/campaigns/:id/{edit,}`. Legacy `/admin/campaigns/*` paths preserved as `LegacyCampaignsRedirect`. Reports panel reads `GET /api/admin/campaigns/stats`. **Open/click metrics intentionally NOT reported** — provider webhooks not wired.
*   **Templates:** `comm_templates` (`lib/db/src/schema/templates.ts`) — `id`, `name`, `category` (5 vals), `channel` (`email|whatsapp`), `subject` (nullable, email-only), `body`, `createdBy/updatedBy` (soft-ref uuids), timestamps, `archivedAt` (soft-delete). Routes under `/api/admin/templates`. **Invariants:** subject required when channel=email; channel locked after create (clone to switch); archived templates immutable (PATCH 409). Preview reuses `lib/campaignRender.ts`. Every mutation writes `comm_template_*` audit row. Campaign editor's "Load from template" picker is channel-filtered. **V1:** no version history.
*   **Module routing:** `App.tsx` wires (behind `RequireAdminAuth`): `/admin`, `/admin/communications`, `/admin/import`, `/admin/exports`, `/admin/users` (superadmin), `/admin/profile`, plus stubs `/admin/{analytics,reports,subscriptions,support,pipelines}` via `pages/admin-stub.tsx`.
*   **CRM polish:** `lib/typeOfEnquiry.ts` collapses visa-type into 7 categories; `components/help-tooltip.tsx` (white-bg/dark-text Radix tooltip) on every leads-table column header; `PreferredCommunicationCell` Radix HoverCard for mask + Reveal/Hide + copy.
*   **Responsiveness:** Kanban touch via `drag-drop-touch` polyfill; tables `overflow-x-auto`-wrapped. **Deferred:** column-priority hide / mobile card layout for the 10-column leads table.

### Phase 4 — Campaign Engine (one-shot bulk)

Tables `campaigns`, `campaign_recipients`, `unsubscribes` in `lib/db/src/schema/campaigns.ts`. Backend pieces: `lib/audienceQuery.ts` (zod-validated single-level AND/OR compiler over a 12-field whitelist, 32-rule cap; shape `{combinator:"and"|"or", rules:[{field,op,value}]}`), `lib/whatsappCampaign.ts` (24h-window detector via `case_messages` inbound), `lib/unsubscribe.ts` (HMAC-signed `(channel,contact)` token, RFC-8058 one-click), `lib/campaignRender.ts` (4 merge tokens: `{{first_name}} {{full_name}} {{reference}} {{organization_name}}`). Routes under `/api/admin/campaigns` (list / create / get / patch-draft / delete-draft / preview / test / send) and `/api/unsubscribe`. **Send route invariants** (post-6D-3A): atomic `draft→sending` claim (concurrent click 409s); queue-readiness gate returns 503 + leaves draft alone; pre-flight refusals revert to draft; 2000-recipient hard cap; 202 with `{queued, preSettled}` returned immediately. **V1 limit:** WA out-of-window sends return `wa_template_send_not_implemented` (Twilio Content templates not wired) → those recipients land as `failed`. In-window WA freeform + all email sends are functional.

### Public assessment flow

*   **Two-Phase Lead Submission:** Lead row committed at end of step 6 (Terms) with `finalize:false` (no email/WA dispatched); confirmation sent only when `POST /api/leads/:id/finalize` is called. Finalize is at-most-once: skips dispatch if any `lead_engagements` row of type `confirmation` already exists. `finalize` flag defaults to `true` for back-compat.
*   **Dynamic step count:** 7 steps without supporting docs, 8 with. Yes/No gate sits between Terms and Upload/Summary.
*   **Session-scoped doc listing:** `DocumentUploader` accepts a `sessionStartedAt` cutoff so a returning user (same email/WA → dedup) never sees previous-session documents.
*   **Inside/outside-SA residence:** "outside SA" excludes ZA via `excludeIso`; "inside" with empty residence auto-selects ZA; switching back clears ZA.
*   **OTP fallback:** Prioritises WhatsApp, falls back to email on provider failure, includes a dev code in non-production.
*   **Idempotent lead-to-case conversion:** Repeated convert calls never create duplicates.
*   **Reference number is post-finalize-only:** Generated server-side at insert (end of step 6) but **never** rendered inside the assessment flow. After `finalize`, redirects to `/thank-you/:reference` — the single reference-revealing surface. Don't re-introduce a Summary-step reference banner.

### Admin / CRM

*   **Admin Auth (email + password):** `admin_users`, `admin_sessions`, `admin_password_resets` in `lib/db/src/schema/admin.ts`. Login mints opaque session id stored server-side, set as httpOnly `ema_admin_session` cookie (7-day TTL, sameSite=lax, secure in prod). `requireAdminAuth` / `requireAdminToken` check cookie first, fall back to legacy `x-admin-token` header. On startup, if `admin_users` empty, demo admin (`demo@admin.local` / `ChangeMe!2026`, override via `BOOTSTRAP_ADMIN_*`) seeded as superadmin (creds logged at WARN). Forgot-password mints 1-hour single-use sha256-hashed token emailed via Resend; `/admin/users` superadmin-only with self-protection guard. **Frontend convention:** new admin fetches use `credentials:"include"` and skip `getAdminToken()`; the helper still returns placeholder `"cookie-auth"` so existing `if(!token)return;` guards stay green.
*   **Admin Layout Shell:** `components/admin-layout.tsx` is the single chrome — sticky topbar with brand logo, `<TopbarGreeting/>`, per-page `actions` slot, `<TopbarClock/>`, `<AdminUserMenu/>`. **No left sidebar — `AdminUserMenu` is sole nav surface**, grouped Workspace / Operations / Intelligence / Admin covering all 12 modules + Logout. `TopbarGreeting`/`TopbarClock` share a single minute-aligned `useMinuteClock()` hook in `dashboard-greeting.tsx`.
*   **Bidirectional Lead Pipeline:** Statuses are bidirectional. **Single hard invariant:** entering `converted` requires current status = `ready_for_case` (or already `converted`), because the same PATCH triggers `ensureCaseForLead`. Moving back OUT of `converted` is permitted; the linked `lead_cases` row is left in place. Case statuses remain forward-only. Server enforcement: PATCH `/api/admin/leads/:id` WHERE-clause predicate (atomic, closes TOCTOU); UI mirror: `lib/leadStatus.ts → canAdvanceStatus`. Unauthorised earlier-status → converted is rejected with HTTP 409.
*   **Optimistic UI w/ server validation:** Admin CRM uses optimistic updates with server re-validation and rollback for critical actions like status changes.

### Security & data hygiene

*   **WhatsApp webhook fail-closed** — 503 if neither `WHATSAPP_APP_SECRET` nor `TWILIO_AUTH_TOKEN` set; 401 on missing/invalid `X-Twilio-Signature` (no inbound message persisted).
*   **`POST /api/leads` rate limits:** per-hour sliding window (10/IP, 5/email, 5/canonical-WA) before zod parsing, plus `website` honeypot returning synthetic 201 without writing.
*   **Audit trail:** every privileged admin mutation writes `lead_audit` row via `lib/audit.ts`; actor credential is sha256-hashed (cookie session id OR `x-admin-token`); raw value never stored. Frontend-only events use `POST /api/admin/audit` (allow-list). `lead_audit.actor_user_id` lets cookie-authed mutations be attributed to a real admin without reversing the hash.
*   **Public APIs minimise PII** — status-lookup endpoints generalise info, complemented by enumeration defence + rate limiting.

## Product

Public 5-step assessment with optional document upload (PDF/JPG/PNG/DOC/DOCX), WhatsApp + email engagement, public status lookup, admin CRM (leads + cases, forward-only case lifecycle, bidirectional lead pipeline), inbound WA processing with intent detection, bulk campaign engine (email + WA, audience query builder, unsubscribe registry, reusable templates, queue-backed dispatch).

## User preferences

*   I prefer concise and accurate responses.
*   I like to work iteratively — discuss/review changes in stages, not large all-at-once changes.
*   Ask for confirmation before significant changes to the codebase or architectural decisions.
*   Ensure solutions are robust and consider edge cases.

## Gotchas

Genuinely surprising things that will bite a future contributor.

*   **WhatsApp webhook is fail-closed** — absence of both `WHATSAPP_APP_SECRET` and `TWILIO_AUTH_TOKEN` returns 503 on every call.
*   **Lead Honeypot Field:** The public form must NEVER render an input named `website`; the API silently rejects any submission whose body includes a non-empty `website` (returns synthetic 201 with id `00000000-…` and reference `EMA-PENDING-OK`). New form fields must avoid that name.
*   **Document Deletion Scope:** `DELETE /api/documents/:id` requires `leadId` scope and rejects requests without it.
*   **Step 7 Schema Optionality:** `wantsToUploadDocuments` is `.optional()` in the assessment zod schema even though the UI requires it, so step 6's `type=submit` Continue button isn't silently blocked by zod-resolver before the user has seen the gate. Submit/Finalize buttons enforce the choice via `disabled={!wantsDocs}`.
*   **DocumentUploader allow-list is server-side only:** Frontend MIME/extension allow-list removed (`accept="*/*"`) with a soft hint; server's allow-list in `routes/documents.ts` is the source of truth.
*   **Autofill on WhatsApp input:** Chromium occasionally autofills the WhatsApp field; handled by clearing during tests.
*   **Campaign send returns 202, not 200** (post-6D-3A). UIs that read `tally` from the response need to switch to polling campaign-detail for live counter updates.
*   **Campaign send queue-readiness:** First `/send` call within ~1s of API boot can return 503 (queue not ready). Operator just retries. The scheduler's tick has the same gate, so a scheduled campaign whose fire time lands in the boot-warmup window is silently deferred to the next 30s tick (no audit row written).
*   **Pause is best-effort, not instant** (post-6D-3B). Recipients already claimed by the worker at pause time will still dispatch — only NEW worker claims see the paused state and revert `sending → queued`. Resume re-enqueues every still-`queued` recipient. Pausing an actively-draining campaign may still send up to ~`batchSize=8` more emails before the pause "lands."
*   **Scheduled campaigns remain editable** (post-6D-3B). PATCH accepts both `draft` and `scheduled` status. The dispatch path re-evaluates the audience query at fire time, so last-minute filter changes are honoured. If audience becomes empty between schedule and fire, scheduler reverts to `draft` (audit row written, no operator notification).
*   **Stuck `sending` recipients:** A hard process kill between the atomic `queued→sending` claim and the worker's terminal settle leaves the recipient row in `sending` indefinitely (pg-boss retry no-ops because the claim requires `status='queued'`). Acceptable single-replica MVP gap; manual SQL flip to `failed` if needed.
*   **Email body is stored as raw HTML** (post-6D-2). Sanitiser runs on write AND render — never bypass it. Plain-text WA bodies remain plain text.
*   **Source attribution endpoint is bespoke** (post-6E). `/api/stats/source-attribution` is intentionally outside OpenAPI — frontend fetches via plain `useQuery`, no orval hook. Don't add it to the spec until the shape stabilises.
*   **Legal Modals:** All legal modals currently display placeholder copy awaiting final review. (V1 limitation.)
*   **Orphaned Blobs:** Object storage blobs are not deleted when documents are removed. (V1 limitation.)

## Pointers

*   _Populate as you build_
