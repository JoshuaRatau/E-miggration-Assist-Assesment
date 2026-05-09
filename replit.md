# E-Migration Assist

E-Migration Assist helps users navigate the immigration process by providing a 5-step assessment, optional document uploads, and WhatsApp integration, while offering an administrative CRM for lead management.

## Run & Operate

*   `pnpm install` / `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm orval` / `pnpm db:push`

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

Listed newest-first. Earlier-phase iteration history (chrome v1→v3.1, sidebar removal, etc.) lives in git. Older blocks are intentionally compressed; if a detail isn't here it's either obvious from the code or in `git log`.

### Phase 6D-3B — Scheduled send + pause/resume

Builds on 6D-3A. Schema: `campaigns.scheduled_at timestamptz NULL`; status enum extended `draft|scheduled|sending|paused|completed|cancelled` (text col, no DB enum). **Shared dispatch path** extracted into `lib/campaignDispatch.ts → dispatchClaimedCampaign(campaign, log)` — caller is responsible for the atomic claim INTO `sending`; helper does audience-compile → snapshot → materialise recipients (2000 cap) → pre-settle unsubscribes → enqueue, and self-reverts to `draft` on early-exit (empty audience, missing body, no `PUBLIC_BASE_URL`) or self-cancels on materialise/enqueue failure. Used by both `POST /send` and the scheduler. **Scheduler:** `lib/campaignScheduleWorker.ts` — single-replica 30s tick, `isQueueReady()` gate (skips tick instead of burning the schedule), atomic `UPDATE … WHERE status='scheduled' AND scheduled_at<=now() RETURNING *` is the lock so the operator's `/unschedule` either wins or loses cleanly (no TOCTOU). System-actor audit rows written directly (no req context). Boot-time immediate `void runTick()` self-skips via the queue gate. **New routes** (under `/api/admin/campaigns/:id`): `/schedule` (z.datetime body, 30s min / 90 days max), `/unschedule` (scheduled→draft, clears scheduledAt), `/pause` (sending→paused), `/resume` (paused→sending; re-enqueues every recipient still in `queued`; queue-readiness gate; calls `maybeFinaliseCampaign` afterwards as a safety finaliser for the case where pause occurred after the worker drained every queued row — otherwise the campaign would be stuck in `sending` with counters≥total but no jobs to finalise it). **PATCH `/admin/campaigns/:id` now accepts both `draft` and `scheduled`** so operators can keep editing right up until the scheduler claims the row — atomic UPDATE WHERE `status IN ('draft','scheduled')` so a mid-claim PATCH 409s safely. **Worker pause check** (`campaignSendWorker.ts`) was the architect-flagged correctness bug in v1: settling-as-skipped during pause terminally lost recipients; fixed to **revert** the recipient `sending → queued` (UPDATE WHERE status='sending' is race-defensive) so resume re-enqueues them. **Frontend:** editor adds Schedule-for-later button + datetime-local picker dialog; detail page adds Pause / Resume / Cancel-schedule buttons (status-conditional), scheduled countdown banner (1-min tick), paused banner, status-pill colour map, and 5s polling while status is `sending|paused|scheduled`. Editor's stale `json.tally` toast bug from 6D-3A also fixed (now reads `json.queued` / `json.preSettled`). **Out of scope V2:** recurring/cron schedules, multi-replica leader election, in-flight pause (workers that already claimed a recipient at pause time will dispatch — only NEW claims see the pause).

### Phase 6D-3A — Background queue for campaign sends

Campaign sends moved from inline `for`-loop to a **pg-boss v12** queue. `lib/queue.ts` boots a single named queue (`campaign-recipient-send`) on the api-server (single-replica) with `batchSize:8` + 1s polling; pg-boss schema (`pgboss.*`, 8 tables) is auto-created on first start. **`POST /api/admin/campaigns/:id/send` now returns 202** with `{campaign, queued, preSettled}` instead of 200 — operators see the campaign tick from `sending` → `completed` as the worker chews through. **Recipient cap raised 200 → 2000.** Per-recipient worker (`lib/campaignSendWorker.ts`) does atomic `queued→sending` claim (concurrent worker no-ops if 0 rows updated), then dispatches via existing email/WA paths from Phase 4, then settles to `sent`/`failed`/`skipped` and bumps campaign counters via `sql\`col + 1\`` (race-safe). Atomic finaliser uses `UPDATE … WHERE counters>=total` so exactly one worker flips the campaign to `completed`. **Three architect-flagged hardenings:** (1) post-claim try/catch settles recipient as `failed` with reason `worker_exception` — no stuck `sending` rows from worker exceptions (only a hard process kill can cause that now); (2) `isQueueReady()` gate in the send route returns 503 + leaves draft alone if the queue isn't up yet (boot race / pgboss schema-create failure) — previously would atomically claim → fail to enqueue → permanently bury the draft as `cancelled`; (3) per-job try/catch in the queue batch worker swallows errors so a single bad job never poisons its 7 siblings. SIGTERM/SIGINT shutdown is graceful (10s timeout). **6D-3B is the next PR:** scheduled send + pause/resume + UI surfaces.

### Phase 6D-2 — Rich-text email composer

TipTap-based editor (`components/CampaignBodyEditor.tsx`) replaces the textarea on the email-channel campaign editor: bold/italic/underline/strike, headings H1–H3, bullet/ordered lists, blockquote, link (with sanitised href), image upload via existing `/api/uploads` endpoint (returns object-storage URL, inserted as `<img>` tag). WA channel keeps the textarea (WhatsApp body must stay plain text). **Server-side sanitiser** (`lib/htmlSanitize.ts`, DOMPurify-backed) runs on every incoming email body in `POST /api/admin/campaigns` and `PATCH /:id` before persistence — strips `<script>`, event handlers, `javascript:` URLs, restricts to a tag/attr allow-list. Same sanitiser also runs at render time in `lib/campaignRender.ts` as a defence-in-depth second pass. Stored as raw HTML; preview/test/send all use the same render path so WYSIWYG is faithful.

### Phase 6D-1 — Per-channel SLA fields & follow-up surface

`prelaunch_leads` gained `sla_email_due_at`, `sla_whatsapp_due_at`, `sla_phone_due_at` (all nullable timestamps). Set/cleared by the lead-detail editor (PATCH `/api/admin/leads/:id`); rendered as a per-channel due-date pill in the leads-table "Next Follow-up" column with overdue-amber / due-today-blue / on-track-grey colour states. Sort/filter by SLA-due is V2.

### Phase 6B — Tier-aware lead scoring (event-sourced)

Replaces the legacy synchronous `deriveLeadScore` heuristic with an append-only `lead_events` stream + a 60s recompute worker. Every score has a traceable event trail. **Schema:** `lead_events (id, lead_id, type, points, rubric, payload jsonb, source, occurred_at)` with `(lead_id, occurred_at)` idx; `prelaunch_leads` gained 3 nullable score-meta cols (`lead_score_rubric`, `lead_score_breakdown jsonb`, `lead_score_computed_at`) so worker output is queryable without re-walking events. **Rubrics-in-code:** `lib/scoringRubrics.ts` defines 3 rubrics (`self_serve`/`sales`/`static`) routed by `pickRubricForTier(intendedTier)` — self-serve for the 5 B2C tiers, sales for the 5 B2B/concierge tiers, static fallback for null/unknown. Each rule has `points`, optional `maxOccurrences`, optional `decayDays`. `pointsFor(rubric, type)` is **snapshotted into each event row** so historical contributions stay immutable when the rubric is later tweaked. **Worker:** `lib/scoreWorker.ts` runs in-process (single replica), 60s tick, 200/batch transactional backfill (`>=` dirty predicate eliminates restart drift), wrapped in try/catch. **API:** `serializeLead` exports the 3 score-meta fields; new `GET /api/admin/leads/:id/events` returns events stream + score meta (intentionally NOT in OpenAPI — sibling-resource shape may evolve). `recordLeadEvent({leadId, type, source, payload?})` is the canonical write helper — fire-and-forget, internally try/catch'd. **Wired at 4 sites:** `POST /api/leads` → `lead_created`, `POST /api/leads/:id/finalize` → `assessment_completed` (after at-most-once guard), `PATCH /api/admin/leads/:id` → `status_advanced` (forward only) and `tier_set` (set-to-non-null only, `maxOccurrences:1`). **Frontend:** `LeadScoreBadge` prefers worker-computed values, falls back to legacy `deriveLeadScore` for unprocessed leads. `LeadActivityPanel` on `/admin/leads/:id` shows events stream + rubric snapshot. **V1 gap:** ~60s lag between PATCH and next worker tick may show stale score; falling back to `deriveLeadScore` was rejected to avoid server→legacy→server flicker.

### Phase 6A.5 — Tier-aware lead intent

Nullable `prelaunch_leads.intended_tier text` capturing commercial-tier intent. 11 allowed values across 3 motions: B2C self-serve (`free`, `basic`, `plus`, `pro`, `premium`), B2B firm (`starter_firm`, `growth_firm`, `scale_firm`, `enterprise`), white-glove (`concierge`), plus `unknown`. Allow-list enforced at the API layer (no migration needed to add a tier). Server source: `INTENDED_TIER_VALUES` in `routes/adminLeads.ts`; frontend mirror: `lib/intendedTier.ts` (motion classifier + per-tier badge classes). Surfaced on slim list serializer, full Lead schema, audience-query builder, leads-table Name-cell pill, and lead-detail dropdown. PATCH accepts explicit `null` to clear; tier changes write `lead_intended_tier_changed` audit row. **Public `POST /api/leads` insert path was not touched.** Foundational for 6B/6C/6D.

### Phase 6A.1 — Lead funnel trim (10 → 9 stages)

Dropped `awaiting_response` (duplicated `contacted` + `next_follow_up_at`). Touched canonical enum in `lib/classification.ts`, frontend `lib/leadStatus.ts`, kanban map, scoring weights, audience-query builder, both leads-table dropdowns, OpenAPI Lead schema description, and `prelaunch_leads.lead_status` comment. Pre-existing `lead_audit` rows mentioning `awaiting_response` left untouched (immutable history); no live rows in that status at cutover.

### Phase 6A — B2B Contact Intelligence

`PreferredCommunicationCell` hover-card renders B2B contact card for `leadType="professional"` rows: contact name, role/title, organisation, **relationship** (Primary Decision-Maker / Departmental / General Operations), **email-type** (Personal / Departmental / Generic). B2C rows keep the masked-by-default address. **Schema:** `prelaunch_leads` gained `representative_role`, `representative_relationship` (nullable text); when NULL, fallbacks come from `lib/b2bContactIntelligence.ts` (role from `organizationType`; relationship inferred from email local-part — generic `info@`/`admin@`/`hr@` → General Ops; matches rep's name → Primary; else Departmental). Free-mail domains always personal. **API:** `AdminLeadListItem` extended with `representativeName/Email/Role/Relationship`, `firmSize`, `serviceFocus` to avoid N+1.

### Phase 5 — Executive Dashboard / CRM Operations (compressed)

*   **Data model:** `prelaunch_leads` gained `lead_type` (NOT NULL DEFAULT `individual`), `inquiry_type`, `source` (DEFAULT `web_form`), `assigned_to` (uuid soft-ref to `admin_users.id`, validated at API layer — no FK), `last_contacted_at`, `next_follow_up_at`, `tags text[]`, plus 10 professional-lead cols (`organization_*`, `representative_*`, `website`, `firm_size`, `operating_regions`, `service_focus`, `estimated_client_volume`). `admin_users` gained `role` col (`superadmin|admin|sales|operations|viewer`) coexisting with the authoritative `is_superadmin` boolean. Status enum 7 → 10 (later 9 in 6A.1); priority gained `critical`. OpenAPI Lead schema extended; `AdminLeadListItem` (slim) and `PublicLead` (public-safe) codify the smaller payloads.
*   **Communications hub:** `/admin/communications` four-tab shell (Campaigns / Templates / System Notifications [V1 placeholder] / Reports), tab from URL. Editor/detail at `/admin/communications/campaigns/:id/{edit,}`. Legacy `/admin/campaigns/*` paths preserved as `LegacyCampaignsRedirect` (replace-redirects). Reports panel reads `GET /api/admin/campaigns/stats`. **Open/click metrics intentionally NOT reported** — provider webhooks not wired.
*   **Draft Templates:** `comm_templates` (`lib/db/src/schema/templates.ts`) — `id`, `name`, `category` (5 vals), `channel` (`email|whatsapp`), `subject` (nullable, email-only), `body`, `createdBy/updatedBy` (soft-ref uuids), timestamps, `archivedAt` (soft-delete). Routes under `/api/admin/templates`. **Invariants:** subject required when channel=email (create + patch); channel locked after create (clone to switch); archived templates immutable (PATCH 409). Preview reuses `lib/campaignRender.ts`. Every mutation writes `comm_template_*` audit row. Campaign editor's "Load from template" picker is channel-filtered. **V1:** no version history.
*   **Module routing:** `App.tsx` wires (behind `RequireAdminAuth`): `/admin`, `/admin/communications`, `/admin/import`, `/admin/exports`, `/admin/users` (superadmin), `/admin/profile`, plus stubs `/admin/{analytics,reports,subscriptions,support,pipelines}` via `pages/admin-stub.tsx`.
*   **CRM polish:** `lib/typeOfEnquiry.ts` collapses visa-type into 7 categories; `components/help-tooltip.tsx` (white-bg/dark-text Radix tooltip) on every leads-table column header; `PreferredCommunicationCell` Radix HoverCard for mask + Reveal/Hide + copy; table density `py-3`/`even:bg-muted/10`/hover tint.
*   **Responsiveness:** Kanban touch via `drag-drop-touch` polyfill; 5 tables `overflow-x-auto`-wrapped; `admin-import.tsx` preview-stats `grid-cols-1 sm:grid-cols-3`; tab strip horiz-scrolls <=375px. **Deferred:** column-priority hide / mobile card layout for the 10-column leads table.

### Phase 4 — Campaign Engine (one-shot bulk)

Tables `campaigns`, `campaign_recipients`, `unsubscribes` in `lib/db/src/schema/campaigns.ts`. Backend pieces: `lib/audienceQuery.ts` (zod-validated single-level AND/OR compiler over a 12-field whitelist, 32-rule cap; shape is `{combinator:"and"|"or", rules:[{field,op,value}]}`), `lib/whatsappCampaign.ts` (24h-window detector via `case_messages` inbound), `lib/unsubscribe.ts` (HMAC-signed `(channel,contact)` token, RFC-8058 one-click), `lib/campaignRender.ts` (4 merge tokens: `{{first_name}} {{full_name}} {{reference}} {{organization_name}}`). Routes under `/api/admin/campaigns` (list / create / get / patch-draft / delete-draft / preview / test / send) and `/api/unsubscribe`. **Send route invariants** (post-6D-3A): atomic `draft→sending` claim (concurrent click 409s); queue-readiness gate returns 503 + leaves draft alone; pre-flight refusals revert to draft; 2000-recipient hard cap; 202 with `{queued, preSettled}` returned immediately; per-recipient delivery happens off-request via the queue. **Known V1 limit:** WhatsApp out-of-window sends return `wa_template_send_not_implemented` (Twilio Content templates not wired) — those recipients land as `failed`. In-window WA freeform + all email sends are functional.

### Public assessment flow

*   **Two-Phase Lead Submission:** Lead row committed at end of step 6 (Terms) with `finalize:false` (no email/WA dispatched); confirmation sent only when `POST /api/leads/:id/finalize` is called. Finalize is at-most-once: skips dispatch if any `lead_engagements` row of type `confirmation` already exists for the lead. The `finalize` flag defaults to `true` for back-compat.
*   **Dynamic step count:** 7 steps without supporting docs, 8 with. Yes/No gate sits between Terms and Upload/Summary.
*   **Session-Scoped Document Listing:** `DocumentUploader` accepts a `sessionStartedAt` cutoff so a returning user (same email/WA → dedup match) never sees previous-session documents.
*   **Inside/Outside-SA Residence Logic:** "outside SA" excludes ZA via `excludeIso`; "inside" with empty residence auto-selects ZA; switching back to "outside" clears ZA.
*   **OTP Verification with Fallback:** Prioritises WhatsApp, falls back to email on provider failure, includes a dev code in non-production.
*   **Idempotent Lead-to-Case Conversion:** Repeated convert calls never create duplicates.
*   **Reference number is post-finalize-only:** Generated server-side at insert (end of step 6) but **never** rendered inside the assessment flow. After `finalize`, `finalizeAndShowSummary` redirects to `/thank-you/:reference` — the single reference-revealing surface. The in-page Summary block in `assessment.tsx` is a defensive fallback only; do not re-introduce a Summary-step reference banner.

### Admin / CRM

*   **Admin Auth (email + password):** `admin_users`, `admin_sessions`, `admin_password_resets` in `lib/db/src/schema/admin.ts`. Login mints opaque session id stored server-side, set as httpOnly `ema_admin_session` cookie (7-day TTL, sameSite=lax, secure in prod). `requireAdminAuth` / `requireAdminToken` check cookie first, fall back to legacy `x-admin-token` header. On startup, if `admin_users` empty, demo admin (`demo@admin.local` / `ChangeMe!2026`, override via `BOOTSTRAP_ADMIN_*`) seeded as superadmin (creds logged at WARN). Forgot-password mints 1-hour single-use sha256-hashed token emailed via Resend; `/admin/users` superadmin-only with self-protection guard. **Frontend convention:** new admin fetches use `credentials:"include"` and skip `getAdminToken()`; the helper still returns placeholder `"cookie-auth"` so existing `if(!token)return;` guards stay green.
*   **Admin Layout Shell:** `components/admin-layout.tsx` is the single chrome — sticky topbar with brand logo, `<TopbarGreeting/>`, per-page `actions` slot, `<TopbarClock/>`, `<AdminUserMenu/>`. **No left sidebar — `AdminUserMenu` is the sole nav surface**, grouped Workspace / Operations / Intelligence / Admin covering all 12 modules + Logout. `TopbarGreeting`/`TopbarClock` share a single minute-aligned `useMinuteClock()` hook in `dashboard-greeting.tsx`.
*   **Bidirectional Lead Pipeline:** Statuses are bidirectional. **Single hard invariant:** entering `converted` requires current status = `ready_for_case` (or already `converted`), because the same PATCH triggers `ensureCaseForLead` and case creation must be deliberate. Moving back OUT of `converted` is permitted; the linked `lead_cases` row is left in place. Case statuses remain forward-only. Server enforcement: PATCH `/api/admin/leads/:id` WHERE-clause predicate (atomic, closes TOCTOU); UI mirror: `lib/leadStatus.ts → canAdvanceStatus`. Unauthorised earlier-status → converted is rejected with HTTP 409.
*   **Optimistic UI w/ server validation:** Admin CRM uses optimistic updates with server re-validation and rollback for critical actions like status changes.

### Security & data hygiene

*   **WhatsApp webhook fail-closed** — 503 if neither `WHATSAPP_APP_SECRET` nor `TWILIO_AUTH_TOKEN` set; 401 on missing/invalid `X-Twilio-Signature` (no inbound message persisted).
*   **`POST /api/leads` rate limits:** per-hour sliding window (10/IP, 5/email, 5/canonical-WA) before zod parsing, plus `website` honeypot returning synthetic 201 without writing.
*   **Audit trail:** every privileged admin mutation writes `lead_audit` row via `lib/audit.ts`; actor credential is sha256-hashed (cookie session id OR `x-admin-token`) and the raw value is never stored. Frontend-only events use `POST /api/admin/audit` (allow-list). `lead_audit.actor_user_id` lets cookie-authed mutations be attributed to a real admin without reversing the hash.
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

*   **WhatsApp webhook is fail-closed** (see Security block) — absence of both `WHATSAPP_APP_SECRET` and `TWILIO_AUTH_TOKEN` returns 503 on every call.
*   **Lead Honeypot Field:** The public form must NEVER render an input named `website`; the API silently rejects any submission whose body includes a non-empty `website` (returns synthetic 201 with id `00000000-…` and reference `EMA-PENDING-OK`). New form fields must avoid that name.
*   **Document Deletion Scope:** `DELETE /api/documents/:id` requires `leadId` scope and rejects requests without it.
*   **Step 7 Schema Optionality:** `wantsToUploadDocuments` is `.optional()` in the assessment zod schema even though the UI requires it, so step 6's `type=submit` Continue button isn't silently blocked by zod-resolver before the user has seen the gate. Submit/Finalize buttons enforce the choice via `disabled={!wantsDocs}`.
*   **DocumentUploader allow-list is server-side only:** Frontend MIME/extension allow-list removed (`accept="*/*"`) with a soft hint; server's allow-list in `routes/documents.ts` is the source of truth.
*   **Autofill on WhatsApp input:** Chromium occasionally autofills the WhatsApp field; handled by clearing during tests.
*   **Campaign send returns 202, not 200** (post-6D-3A). Existing UIs that read `tally` from the response need to switch to polling campaign-detail for live counter updates.
*   **Campaign send queue-readiness:** First `/send` call within ~1s of API boot can return 503 (queue not ready). Operator just retries. The scheduler's tick has the same gate, so a scheduled campaign whose fire time lands in the boot-warmup window is silently deferred to the next 30s tick (no audit row written).
*   **Pause is best-effort, not instant** (post-6D-3B). Recipients already claimed by the worker at pause time will still dispatch — only NEW worker claims see the paused state and revert `sending → queued`. Resume re-enqueues every still-`queued` recipient. Practical impact: pausing an actively-draining campaign may still send up to ~`batchSize=8` more emails before the pause "lands."
*   **Scheduled campaigns remain editable** (post-6D-3B). PATCH accepts both `draft` and `scheduled` status. The dispatch path re-evaluates the audience query at fire time, so last-minute filter changes are honoured. If the audience becomes empty between schedule and fire, the scheduler reverts the campaign to `draft` (audit row written, no operator notification — they'll see it on next page load).
*   **Stuck `sending` recipients:** A hard process kill between the atomic `queued→sending` claim and the worker's terminal settle leaves the recipient row in `sending` indefinitely (pg-boss retry no-ops because the claim requires `status='queued'`). Acceptable single-replica MVP gap; manual SQL flip to `failed` if needed.
*   **Email body is stored as raw HTML** (post-6D-2). Sanitiser runs on write AND render — never bypass it. Plain-text WA bodies remain plain text.
*   **Legal Modals:** All legal modals currently display placeholder copy awaiting final review. (V1 limitation.)
*   **Orphaned Blobs:** Object storage blobs are not deleted when documents are removed. (V1 limitation.)

## Pointers

*   _Populate as you build_
