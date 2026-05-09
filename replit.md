# E-Migration Assist

E-Migration Assist helps users navigate the immigration process by providing a 5-step assessment, optional document uploads, and WhatsApp integration, while offering an administrative CRM for lead management.

## Run & Operate

*   **Install dependencies:** `pnpm install`
*   **Run development server:** `pnpm dev`
*   **Build:** `pnpm build`
*   **Typecheck:** `pnpm typecheck`
*   **Generate OpenAPI client:** `pnpm orval`
*   **DB Push:** `pnpm db:push` (DrizzleKit migrations)

**Required Environment Variables:**
*   `DATABASE_URL`: PostgreSQL connection string
*   `ADMIN_EMAIL_TOKEN`: Legacy operator-only `x-admin-token` fallback (kept for back-compat with scripts)
*   `RESEND_API_KEY`: Resend API key for email sending
*   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: Twilio credentials for WhatsApp
*   `OTP_SECRET`: Secret for OTP hashing
*   `REPLIT_OBJECT_STORAGE_URL`: Replit Object Storage endpoint
*   `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (optional): override the seeded demo admin (defaults: `demo@admin.local` / `ChangeMe!2026`)
*   `PUBLIC_BASE_URL` (optional): public origin used to build password-reset links (falls back to `https://$REPLIT_DEV_DOMAIN`)
*   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (optional): preferred webhook signature verification path; falls back to `TWILIO_AUTH_TOKEN` HMAC.

## Stack

*   **Frameworks:** Express 5 (backend), React (frontend)
*   **Runtime:** Node.js 24, TypeScript 5.9
*   **ORM:** Drizzle ORM
*   **Validation:** Zod
*   **Build Tool:** esbuild
*   **Database:** PostgreSQL

## Where things live

*   **Backend API Routes:** `artifacts/api-server/src/routes/`
*   **Backend Shared Lib:** `artifacts/api-server/src/lib/`
*   **Database Schema:** `lib/db/src/schema/` (one file per domain: `leads`, `leadCases`, `admin`, `imports`, `campaigns`, `templates`)
*   **OpenAPI Specification:** `lib/api-spec/openapi.yaml`
*   **Frontend Pages:** `artifacts/emigration-assist/src/pages/`
*   **Frontend Components:** `artifacts/emigration-assist/src/components/`
*   **Frontend Lib:** `artifacts/emigration-assist/src/lib/`
*   **CSS/Theming:** `artifacts/emigration-assist/src/index.css`
*   **Country Data:** `artifacts/emigration-assist/src/lib/countries.ts`
*   **Roadmap:** `ROADMAP.md` (Phase 6A.5 → 6I plan).

## Architecture decisions

Listed newest-first. Earlier-phase iteration history (chrome v1→v3.1, sidebar removal, etc.) lives in git.

### Phase 6B — Tier-aware lead scoring (event-sourced)

Replaces the legacy synchronous `deriveLeadScore` heuristic with an append-only `lead_events` stream + a 60s recompute worker. Every score now has a traceable event trail rather than a black-box derivation. **Schema:** `lead_events (id, lead_id, type, points, rubric, payload jsonb, source, occurred_at)` with `(lead_id, occurred_at)` idx; `prelaunch_leads` gained 3 nullable score-meta columns (`lead_score_rubric`, `lead_score_breakdown jsonb`, `lead_score_computed_at`) so the worker output is queryable without re-walking the events table. **Rubrics-in-code:** `lib/scoringRubrics.ts` defines 3 rubrics (`self_serve` / `sales` / `static`) routed by `pickRubricForTier(intendedTier)` — self-serve for the 5 B2C tiers, sales for the 5 B2B/concierge tiers, static fallback for null/unknown. Each rule has `points`, optional `maxOccurrences` (caps repeats), optional `decayDays` (linear decay window). `pointsFor(rubric, type)` is snapshotted into each `lead_events` row so historical contributions are immutable when the rubric is later tweaked. **Worker:** `lib/scoreWorker.ts` runs in-process on the api-server (single replica), 60s tick, 200/batch transactional backfill of pre-existing leads (`>=` dirty predicate eliminates restart drift), wrapped in try/catch so a single bad lead can't kill the loop. Wired in `index.ts` after `bootstrapAdminAccounts`. **API:** `serializeLead` exports the 3 score-meta fields on `Lead`; new `GET /api/admin/leads/:id/events` returns the events stream + score meta as a single payload (intentionally NOT in OpenAPI — sibling-resource shape may evolve). `recordLeadEvent({leadId, type, source, payload?})` is the canonical write helper — fire-and-forget, internally try/catch'd, never throws. **Wired at 4 sites:** `POST /api/leads` → `lead_created`, `POST /api/leads/:id/finalize` → `assessment_completed` (after the at-most-once guard), `PATCH /api/admin/leads/:id` → `status_advanced` (only on forward moves per `canAdvanceStatus`) and `tier_set` (only on set-to-non-null, never on clears; `maxOccurrences:1` so re-tiering doesn't double-credit). **Frontend:** `LeadScoreBadge` rewritten to prefer worker-computed values when present, fall back to legacy `deriveLeadScore` for unprocessed leads; new optional `showRubric` prop renders a coloured rubric pill. New `LeadActivityPanel` on `/admin/leads/:id` shows the chronological events stream with type, source pill, points contribution, and the rubric snapshot used at write time. `handleSave` invalidates `["admin","lead",id,"events"]` so a tier change immediately refreshes the panel. **Known V1 gap (documented inline):** up to ~60s between a PATCH and the next worker tick the badge may show a slightly stale score. Falling back to `deriveLeadScore` was rejected because it would cause server→legacy→server flicker. **Public `POST /api/leads` flow gained one event emission only** (`lead_created`); no other public-flow changes.

### Phase 6A.5 — Tier-aware lead intent

Nullable `prelaunch_leads.intended_tier text` column captures the commercial tier a lead is heading toward. 11 allowed values across 3 motions: B2C self-serve (`free`, `basic`, `plus`, `pro`, `premium`), B2B firm (`starter_firm`, `growth_firm`, `scale_firm`, `enterprise`), white-glove (`concierge`), plus `unknown`. Allow-list is enforced at the API layer (not the DB) so adding a tier doesn't need a migration. Server source of truth: `INTENDED_TIER_VALUES` in `routes/adminLeads.ts`; frontend mirror: `lib/intendedTier.ts` (motion classifier + per-tier badge classes). Surfaced on the slim list serializer (`AdminLeadListItem`), full `Lead` schema, audience-query builder (filterable for campaigns), an inline tier pill in the leads-table Name cell, and a "Not set" → 11-option dropdown in the lead-detail editor that PATCHes via `/api/admin/leads/:id`. PATCH accepts an explicit `null` to clear; tier changes write a `lead_intended_tier_changed` audit row. **Public `POST /api/leads` insert path was not touched.** Foundational for tier-aware scoring (6B), Stripe Billing (6C), SLA tracking (6D). **V1 deferrals:** no dashboard tier-mix widget, no leads-table column filter, no user-facing tier-picker on the assessment.

### Phase 6A.1 — Lead funnel trim (10 → 9 stages)

Dropped `awaiting_response` — duplicated `contacted` + `next_follow_up_at` with no information gain. Touched the canonical enum in `lib/classification.ts`, frontend mirror `lib/leadStatus.ts`, kanban column map, lead-score weights, audience-query builder, both leads-table dropdowns, the Lead schema description in `openapi.yaml`, and the schema comment on `prelaunch_leads.lead_status`. Pre-existing `lead_audit` rows that mention `awaiting_response` are immutable history and were left untouched. No live rows in that status at cutover.

### Phase 6A — B2B Contact Intelligence

`PreferredCommunicationCell` hover-card renders a full B2B contact card for `leadType = "professional"` rows: contact name, role/title, organisation, **relationship classifier** (Primary Decision-Maker / Departmental / General Operations) and **email-type label** (Personal / Departmental / Generic). B2C rows keep the original masked-by-default address with reveal/copy controls. **Schema:** `prelaunch_leads` gained `representative_role` and `representative_relationship` (both nullable text); when NULL, fallbacks come from `lib/b2bContactIntelligence.ts` — role from `organizationType` (e.g. `law_firm` → "Partner / Attorney"); relationship inferred from email local-part (generic `info@`/`admin@`/`hr@` → General Operations; matches rep's name → Primary Decision-Maker; else Departmental). Free-mail domains are always personal. **API:** `AdminLeadListItem` extended with `representativeName/Email/Role/Relationship`, `firmSize`, `serviceFocus` so the slim list endpoint avoids N+1 fetches. **Public `POST /api/leads` insert path was not touched.**

### Phase 5 — Executive Dashboard / CRM Operations

**Data model:** `prelaunch_leads` gained `lead_type` (NOT NULL DEFAULT 'individual'), `inquiry_type`, `source` (DEFAULT 'web_form'), `assigned_to` (uuid soft-ref to `admin_users.id`, validated at API layer — no FK), `last_contacted_at`, `next_follow_up_at`, `tags` (text[]), and 10 professional-lead columns (`organization_*`, `representative_*`, `website`, `firm_size`, `operating_regions`, `service_focus`, `estimated_client_volume`). `admin_users` gained a `role` column (`superadmin|admin|sales|operations|viewer`) that coexists with the authoritative `is_superadmin` boolean used by `gateSuperadmin()`. Status enum extended 7 → 10 (later trimmed to 9 in 6A.1). Priority gained `critical` above `high`. **Public `POST /api/leads` insert path was not touched.** OpenAPI Lead schema extended; sibling `AdminLeadListItem` and `PublicLead` codify the slim and public-safe payloads.

**CRM polish:** `lib/typeOfEnquiry.ts` collapses the visa-type column into 7 display categories. `components/help-tooltip.tsx` (white-bg, dark-text Radix tooltip) on every leads-table column header. `PreferredCommunicationCell` uses Radix HoverCard for mask-by-default + Reveal/Hide + copy. Table density: `py-3` rows, alternating `even:bg-muted/10`, hover row tint.

**Communications hub:** `/admin/communications` is a four-tab shell (Campaigns / Templates / System Notifications [V1 placeholder] / Reports), tab from URL inside `pages/admin-communications.tsx`. Campaign editor/detail at `/admin/communications/campaigns/:id/edit` and `:id`. Legacy `/admin/campaigns/*` paths preserved as `LegacyCampaignsRedirect` in `App.tsx` (replace-redirects). Reports panel reads `GET /api/admin/campaigns/stats` (status / channel / recipient totals + 10-row recent activity). **Open/click metrics intentionally NOT reported** — provider webhooks (Resend events / WhatsApp delivery receipts) aren't wired; the panel notes this gap.

**Draft Templates:** `comm_templates` (`lib/db/src/schema/templates.ts`) — id, name, category (5 values), channel (`email|whatsapp`), subject (nullable, email-only), body, createdBy/updatedBy (uuid soft-refs), timestamps, archivedAt (soft-delete). Routes under `/api/admin/templates` (list / create / get / patch / archive / unarchive / preview), all behind `requireAdminAuth`. **Email-channel invariant:** subject required on both create and patch when channel=email. **Channel is locked after create** (clone to switch). **Archived templates are immutable** (PATCH returns 409). Preview reuses `lib/campaignRender.ts` so the 4 supported tokens are identical in templates and campaigns. Every mutation writes a `comm_template_*` audit row. Campaign editor's "Load from template" picker is channel-filtered, replaces subject+body, leaves audience+channel untouched, only auto-promotes the campaign name if still `"Untitled campaign"`. **V1 limitation:** no version history.

**Module routing:** `App.tsx` wires (behind `RequireAdminAuth`): `/admin` (Dashboard), `/admin/communications`, `/admin/import`, `/admin/exports`, `/admin/users` (superadmin only), `/admin/profile`, plus stubs `/admin/{analytics,reports,subscriptions,support,pipelines}` rendered by `pages/admin-stub.tsx` so launcher items never dead-click. Bulk CSV export at `/admin/exports` → `GET /api/leads/export.csv` with `credentials: "include"`.

**Responsiveness:** Kanban drags on touch via `drag-drop-touch` polyfill (side-effect import in `lead-pipeline-board.tsx`). Five tables are `overflow-x-auto`-wrapped (admin-users, communications Campaigns + Reports, campaign-detail recipients, import mapping). `admin-import.tsx` preview-stats grid is `grid-cols-1 sm:grid-cols-3`. Communications tab strip scrolls horizontally on <=375px. **Deferred:** column-priority hide / mobile card layout for the 10-column leads table.

### Phase 4 — Campaign Engine (one-shot bulk)

Tables `campaigns`, `campaign_recipients`, `unsubscribes` in `lib/db/src/schema/campaigns.ts`. Backend pieces: `lib/audienceQuery.ts` (zod-validated single-level AND/OR query compiler over a 12-field whitelist, 32-rule cap), `lib/whatsappCampaign.ts` (24h-window detector via `case_messages` inbound), `lib/unsubscribe.ts` (HMAC-signed `(channel, contact)` token; SECRET fails closed in production if `UNSUBSCRIBE_SECRET`/`SESSION_SECRET` unset), `lib/campaignRender.ts` (4 merge tokens: `{{first_name}} {{full_name}} {{reference}} {{organization_name}}`). Routes under `/api/admin/campaigns` (list / create / get / patch-draft / delete-draft / preview / test / send) and `/api/unsubscribe` with RFC-8058 one-click semantics.

**Send route invariants:** atomic draft→sending claim (concurrent click 409s); 200-recipient hard cap; pre-flight refusals revert to draft; per-recipient failures stay non-fatal; the post-claim loop is wrapped in try/catch so any uncaught exception still finalises the row to `cancelled` (never stuck in `sending`); email sends are refused with 500 if no `PUBLIC_BASE_URL`/`REPLIT_DEV_DOMAIN` is set so the unsubscribe footer is always present.

**Known V1 limitation:** WhatsApp out-of-window sends require a Twilio Content template; the dispatcher returns `wa_template_send_not_implemented` so those recipients land as `failed` until the Content API call is wired in. In-window WA freeform and all email sends are functional.

### Public assessment flow

*   **Two-Phase Lead Submission:** The lead row is committed at end of step 6 (Terms) with `finalize:false` (no email/WhatsApp dispatched); confirmation is sent only when `POST /api/leads/:id/finalize` is called. Finalize is at-most-once: skips dispatch if any `lead_engagements` row of type `confirmation` already exists for the lead, bounding the abuse surface of the unauthenticated endpoint. The `finalize` flag defaults to `true` for back-compat — new callers that want to defer dispatch must pass `finalize:false` explicitly.
*   **Dynamic Assessment Step Count:** 7 steps when the user opts out of supporting documents, 8 when they opt in. The Yes/No "do you have supporting documents?" gate sits between Terms and Upload/Summary.
*   **Session-Scoped Document Listing:** `DocumentUploader` accepts a `sessionStartedAt` cutoff and filters out documents created before that moment, so a returning user (same email/whatsapp → dedup match on the existing lead) never sees documents from a previous session.
*   **Inside/Outside-SA Residence Logic:** "outside South Africa" excludes ZA from the residence dropdown via `excludeIso`; "inside" with empty residence auto-selects ZA; switching back to "outside" clears ZA.
*   **OTP Verification with Fallback:** OTP requests prioritize WhatsApp, fall back to email on provider failure, and include a development code in non-production.
*   **Idempotent Lead-to-Case Conversion:** Repeated convert calls never create duplicates.
*   **Reference number is post-finalize-only:** Generated server-side at insert (end of step 6) but **never** rendered inside the assessment flow. After `finalize` succeeds, `finalizeAndShowSummary` redirects to `/thank-you/:reference` — the single confirmation surface that reveals the reference. The in-page Summary block in `assessment.tsx` is a defensive fallback only; do not re-introduce a Summary-step reference banner.

### Admin / CRM

*   **Admin Auth (email + password):** `admin_users`, `admin_sessions`, `admin_password_resets` in `lib/db/src/schema/admin.ts`. Login mints an opaque session id stored server-side and set as the httpOnly `ema_admin_session` cookie (7-day TTL, sameSite=lax, secure in prod). `requireAdminAuth` / `requireAdminToken` check the cookie first and fall back to the legacy `x-admin-token` header. On startup, if `admin_users` is empty, a demo admin (`demo@admin.local` / `ChangeMe!2026`, override via `BOOTSTRAP_ADMIN_*`) is seeded as superadmin and credentials logged at WARN. Forgot-password mints a 1-hour single-use token (sha256-hashed in DB) emailed via Resend; `/admin/users` is superadmin-only with a self-protection guard. **Frontend convention:** new admin fetches use `credentials: "include"` and skip `getAdminToken()`; the helper still returns placeholder `"cookie-auth"` so existing `if (!token) return;` guards stay green.
*   **Admin Layout Shell:** `components/admin-layout.tsx` is the single chrome — sticky topbar with brand logo (links to `/admin`), `<TopbarGreeting/>`, per-page `actions` slot, `<TopbarClock/>`, and `<AdminUserMenu/>`. **No left sidebar — `AdminUserMenu` is the sole nav surface**, with grouped Workspace / Operations / Intelligence / Admin sections covering all 12 modules + Logout. Per-page customizations flow through `bodyClassName` / `contentClassName` overrides. The `title` prop is back-compat only (the topbar pill it used to render is gone). `TopbarGreeting` and `TopbarClock` share a single minute-aligned `useMinuteClock()` hook in `dashboard-greeting.tsx`.
*   **Bidirectional Lead Pipeline:** Lead statuses are bidirectional — operators may move forward OR backward across the funnel. Single hard invariant: entering `converted` requires the current status to be `ready_for_case` (or already `converted`), because the same PATCH triggers `ensureCaseForLead` and case creation must be deliberate. Moving back OUT of `converted` is permitted; the linked `lead_cases` row is left in place. Case statuses remain forward-only. Server enforcement: PATCH `/api/admin/leads/:id` WHERE-clause predicate (atomic, closes TOCTOU); UI mirror: `lib/leadStatus.ts → canAdvanceStatus`. Unauthorised earlier-status → converted is rejected with HTTP 409.
*   **Optimistic UI with Server-Side Validation:** Admin CRM uses optimistic updates with server re-validation and rollback for critical actions like status changes.

### Security & data hygiene

*   **Pre-Traffic Hardening:** WhatsApp webhook is fail-closed — 503 if neither `WHATSAPP_APP_SECRET` nor `TWILIO_AUTH_TOKEN` is set; 401 on missing/invalid `X-Twilio-Signature` (no inbound message persisted). `POST /api/leads` enforces a per-hour sliding-window limit (10/IP, 5/email, 5/canonical-WA) before zod parsing, plus a `website` honeypot that returns a synthetic 201 without writing. Every privileged admin mutation writes a `lead_audit` row via `lib/audit.ts`; the actor credential is sha256-hashed (cookie session id OR x-admin-token) and the raw value is never stored. Frontend-only events use `POST /api/admin/audit` (allow-list). `lead_audit.actor_user_id` lets cookie-authed mutations be attributed to a real admin without reversing the hash.
*   **Minimal PII in Public APIs:** Public status-lookup endpoints generalise information and avoid revealing PII, complemented by enumeration defense and rate limiting.

## Product

*   Public-facing 5-step assessment for lead capture.
*   Optional document upload (PDF, JPG, PNG, DOC, DOCX).
*   WhatsApp integration for lead contact and OTP verification.
*   Public status lookup using a reference number.
*   Email engagement for confirmations and updates.
*   Lightweight administrative CRM for lead and case management.
*   Lead engagement tracking for outbound communication.
*   Case lifecycle with forward-only status progression.
*   Inbound WhatsApp processing via webhooks with intent detection.
*   Bulk campaign engine (email + WhatsApp) with audience query builder, unsubscribe registry, and reusable draft templates.

## User preferences

I prefer concise and accurate responses.
I like to work iteratively, meaning I prefer to discuss changes and review them in stages rather than having a large change implemented all at once.
Please ask for confirmation before making significant changes to the codebase or architectural decisions.
Ensure all solutions are robust and consider edge cases.

## Gotchas

Genuinely surprising things that will bite a future contributor. Stable patterns have been promoted into Architecture decisions above.

*   **WhatsApp Webhook is Fail-Closed:** Reverses the prior always-200 strategy. Missing/invalid signatures return 401 and Twilio retries per its backoff schedule. Set `WHATSAPP_APP_SECRET` (preferred) or keep `TWILIO_AUTH_TOKEN` set; absence of both yields 503.
*   **Lead Honeypot Field:** The public form must NEVER render an input named `website`; the API silently rejects any submission whose body includes a non-empty `website` string (returns synthetic 201 with id `00000000-…` and reference `EMA-PENDING-OK`). New form fields must avoid that name.
*   **Document Deletion Scope:** `DELETE /api/documents/:id` requires `leadId` scope and rejects requests without it.
*   **Step 7 Schema Optionality:** `wantsToUploadDocuments` is `.optional()` in the assessment zod schema even though the UI requires it, so step 6's `type=submit` Continue button isn't silently blocked by zod-resolver before the user has seen the gate. Submit/Finalize buttons enforce the choice via `disabled={!wantsDocs}`.
*   **DocumentUploader allow-list is server-side only:** Frontend MIME/extension allow-list removed (`accept="*/*"`) with a soft hint; the server's allow-list in `routes/documents.ts` is the source of truth and surfaces rejection messages in the inline error banner.
*   **Autofill on WhatsApp input:** Chromium occasionally autofills the WhatsApp field; handled by clearing during tests.
*   **Legal Modals:** All legal modals currently display placeholder copy awaiting final review. (V1 limitation.)
*   **Orphaned Blobs:** Object storage blobs are not deleted when documents are removed. (V1 limitation.)

## Pointers

*   _Populate as you build_
