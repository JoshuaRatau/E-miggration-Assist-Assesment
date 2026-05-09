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

## Architecture decisions

### Public assessment flow

*   **Two-Phase Lead Submission (V3):** The lead row is committed at end of step 6 (Terms) with `finalize:false` (no email/WhatsApp dispatched); the confirmation is sent only when `POST /api/leads/:id/finalize` is called at the very end of the flow. The finalize route is at-most-once: it skips dispatch if any `lead_engagements` row of type `confirmation` already exists for the lead, bounding the abuse surface of the unauthenticated endpoint. The `finalize` flag defaults to `true` for back-compat — any new caller that wants to defer the dispatch must pass `finalize:false` explicitly.
*   **Dynamic Assessment Step Count:** The assessment is 7 steps when the user opts out of supporting documents, 8 when they opt in. The Yes/No "do you have supporting documents to upload?" gate sits between Terms and Upload/Summary.
*   **Session-Scoped Document Listing:** `DocumentUploader` accepts a `sessionStartedAt` cutoff and filters out documents created before that moment, so a returning user (same email/whatsapp → dedup match on the existing lead) never sees documents from a previous session.
*   **Inside/Outside-SA Residence Logic:** When the user picks "outside South Africa" the residence dropdown excludes ZA via `excludeIso`. When they pick "inside" with an empty residence, ZA is auto-selected; when they switch from a ZA residence back to "outside", ZA is cleared.
*   **OTP Verification with Fallback:** OTP requests prioritize WhatsApp, falling back to email on provider failure, and include a development code for non-production environments.
*   **Idempotent Lead-to-Case Conversion:** Converting a lead to a case is an idempotent operation — repeated attempts never create duplicates.
*   **Reference number is post-finalize-only:** Generated server-side at insert (end of step 6) and stored in `createdLead.referenceNumber`, but **never** rendered inside the assessment flow. After `finalize` succeeds, `finalizeAndShowSummary` redirects to `/thank-you/:reference` — the single confirmation surface that reveals the reference and personalised note. The in-page Summary block in `assessment.tsx` is a defensive fallback only (triggered when `referenceNumber` is somehow missing); do not re-introduce a Summary-step reference banner.

### Admin / CRM

*   **Admin Auth (V3 — email + password):** `admin_users`, `admin_sessions`, `admin_password_resets` tables in `lib/db/src/schema/admin.ts`. Login mints an opaque session id stored server-side and set as the httpOnly `ema_admin_session` cookie (7-day TTL, sameSite=lax, secure in prod). The shared `requireAdminAuth` / `requireAdminToken` middleware checks the cookie first and falls back to the legacy `x-admin-token` header so operator scripts keep working. On startup, if `admin_users` is empty, a demo admin (`demo@admin.local` / `ChangeMe!2026`, override via `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`) is seeded as superadmin and the credentials are logged at WARN. Forgot-password mints a 1-hour single-use token (sha256-hashed in DB) emailed via Resend; "Manage Admins" (`/admin/users`) is superadmin-only and includes a self-protection guard so a superadmin can't disable/demote/delete themselves. **Frontend convention:** new admin fetches use `credentials: "include"` and skip the legacy `getAdminToken()` helper; the helper still returns a placeholder string `"cookie-auth"` so existing fetch sites keep their `if (!token) return;` guards green during the migration.
*   **Admin Layout Shell (chrome v3.1):** `components/admin-layout.tsx` is the single chrome for every admin page — sticky topbar (`h-16 sm:h-20`, `bg-slate-950/60 backdrop-blur`) with: brand logo on the left wrapped in a `Link href="/admin"` (global click-to-Dashboard); `<TopbarGreeting/>` next to the logo (personalised "Good afternoon, Demo", gated on `useAdminAuth().user`, hidden below sm); per-page `actions` slot, `<TopbarClock/>` (compact "Mon, 8 May · 12:38 SAST", hidden below md), and `<AdminUserMenu/>` on the right. **No left sidebar — `AdminUserMenu` is the sole navigation surface**, with grouped Workspace / Operations / Intelligence / Admin sections covering all 12 modules plus an explicit Logout row; identity (name + email + superadmin badge) preserved in the menu header. Body palette is a diagonal `linear-gradient(135deg, #11618c 0%, #114c7e 30%, #0f3667 60%, #0b234a 100%)` aligned to the marketing site's hero image. Per-page customizations flow through `bodyClassName` / `contentClassName` overrides (campaign editor/detail keep `bg-slate-950`; lead/case detail keep their narrower max-w). The `title` prop is accepted but unused (back-compat only — the topbar pill it used to render is gone). `TopbarGreeting` and `TopbarClock` share a single minute-aligned `useMinuteClock()` hook in `dashboard-greeting.tsx`. **Deleted in v3:** `components/workspace-launcher.tsx` (folded into the unified Admin dropdown) and the per-page `<BrandHeader variant="compact" rightSlot={<AdminUserMenu/>}/>` chrome.
*   **Bidirectional Lead Pipeline (Phase 5 §10):** Lead statuses are bidirectional — operators may drag/select forward OR backward across the funnel. The single remaining hard invariant is the `converted` predecessor lock: entering `converted` still requires the current status to be `ready_for_case` (or already `converted`), because the same PATCH triggers `ensureCaseForLead` and case creation must remain a deliberate handover. Moving back OUT of `converted` is permitted; the linked `lead_cases` row is left in place (benign data artefact). Case statuses remain forward-only — only the lead funnel was relaxed. Server-side enforcement lives in the PATCH `/api/admin/leads/:id` route's WHERE-clause predicate (kept atomic to close TOCTOU); UI mirror lives in `lib/leadStatus.ts → canAdvanceStatus`.
*   **Lead Conversion Predecessor Lock (V3.1):** The `converted` terminal status may only be reached from `ready_for_case` (or no-op'd from `converted` itself). Any earlier status → converted is rejected with HTTP 409. Enforced atomically inside the UPDATE's WHERE clause to close the TOCTOU race.
*   **Optimistic UI with Server-Side Validation:** Admin CRM features use optimistic UI updates for responsiveness, with server-side re-validation and rollback for critical actions like status changes.

### Security & data hygiene

*   **Pre-Traffic Hardening (V3.1):** WhatsApp webhook is fail-closed — 503 if neither `WHATSAPP_APP_SECRET` nor `TWILIO_AUTH_TOKEN` is set; 401 if the `X-Twilio-Signature` header is missing or fails HMAC verification (no inbound message is persisted). `POST /api/leads` enforces a per-hour sliding-window limit (10/IP, 5/email, 5/canonical-WA) before zod parsing, plus a `website` honeypot field that returns a synthetic 201 without writing. Every privileged admin mutation writes a row to `lead_audit` via `lib/audit.ts`; the actor credential is sha256-hashed (cookie session id OR x-admin-token) and the raw value is never stored. Frontend-only events use `POST /api/admin/audit` (allow-list of action names) so browser-side actions like tel:/mailto: clicks still land in the trail. CRM Phase A added `actor_user_id` to `lead_audit` so cookie-authed mutations are attributable to a real admin without reversing the hash.
*   **Minimal PII in Public APIs:** Public endpoints for status lookup generalize information and avoid revealing PII, complemented by enumeration defense and rate limiting.

### Phase 4 — Campaign Engine (one-shot bulk)

New tables `campaigns`, `campaign_recipients`, `unsubscribes` in `lib/db/src/schema/campaigns.ts`. Backend pieces: `lib/audienceQuery.ts` (zod-validated single-level AND/OR query compiler over a 12-field whitelist on `prelaunch_leads`, 32-rule cap), `lib/whatsappCampaign.ts` (24h-window detector via `case_messages` inbound), `lib/unsubscribe.ts` (HMAC-signed `(channel, contact)` token; SECRET fails closed in production if `UNSUBSCRIBE_SECRET`/`SESSION_SECRET` unset), `lib/campaignRender.ts` (4 merge tokens: `{{first_name}} {{full_name}} {{reference}} {{organization_name}}`). Routes under `/api/admin/campaigns` (list / create / get / patch-draft / delete-draft / preview / test / send) and `/api/unsubscribe` with RFC-8058 one-click semantics.

**Send route invariants:** atomic draft→sending claim (concurrent click 409s); 200-recipient hard cap; pre-flight refusals revert to draft; per-recipient failures stay non-fatal; the post-claim loop is wrapped in try/catch so any uncaught exception still finalises the row to `cancelled` (never stuck in `sending`); email sends are refused with 500 if no `PUBLIC_BASE_URL`/`REPLIT_DEV_DOMAIN` is set so the unsubscribe footer is always present.

**Known V1 limitation:** WhatsApp out-of-window sends require a Twilio Content template; the dispatcher currently returns `wa_template_send_not_implemented` so those recipients land as `failed` until the Content API call is wired in. In-window WA freeform and all email sends are fully functional.

### Phase 6A.5 — Tier-aware lead intent

New nullable `prelaunch_leads.intended_tier text` column captures the commercial tier a lead is heading toward, drawn from the SaaS pricing ladder. 11 allowed values across 3 motions: B2C self-serve (`free`, `basic`, `plus`, `pro`, `premium`), B2B firm (`starter_firm`, `growth_firm`, `scale_firm`, `enterprise`), white-glove (`concierge`), plus `unknown` sentinel. Allow-list enforced at the API layer (not the DB) so adding a tier doesn't need a migration. Server source of truth is `INTENDED_TIER_VALUES` in `routes/adminLeads.ts`; frontend mirror is `lib/intendedTier.ts` with motion classifier + per-tier badge classes (cool slate/sky for self-serve, indigo for firm, amber for concierge). Surfaced on the slim list serializer (`AdminLeadListItem`), the full `Lead` schema, the audience-query builder (filterable for campaigns), an inline tier pill in the leads-table Name cell (next to the B2B badge), and a "Not set" → 11-option dropdown in the lead-detail editor that PATCHes via the existing `/api/admin/leads/:id` route. PATCH accepts an explicit `null` to clear the tier. **Public `POST /api/leads` insert path was not touched** — the column is nullable. Foundational for tier-aware scoring (Phase 6B), Stripe Billing (6C), and SLA tracking (6D). **V1 deferrals:** no dashboard tier-mix widget, no leads-table column filter (badge only), no user-facing tier-picker on the assessment (deferred until Stripe Checkout is live so the user actually sees their tier on the next screen).

### Phase 6A.1 — Lead funnel trim (10 → 9 stages)

Dropped the `awaiting_response` status. It was a "state of mind" stage that duplicated `contacted` + `next_follow_up_at` and forced operators to context-switch with no information gain. The same query is now expressed as a date filter on `contacted` rows. Touched the canonical enum in `artifacts/api-server/src/lib/classification.ts`, the frontend mirror in `lib/leadStatus.ts`, the kanban column map, the lead-score weights, the audience-query builder, both leads-table dropdowns, the Lead schema description in `openapi.yaml`, and the schema comment on `prelaunch_leads.lead_status`. The pre-existing `lead_audit` rows that mention `awaiting_response` are immutable history and have been left untouched. No live rows in that status at the time of cutover so no data migration was required (defensive `UPDATE … WHERE lead_status='awaiting_response'` was run as a safety net and matched zero rows).

### Phase 6A — B2B Contact Intelligence (email-pill hover)

First slice of the "intelligent CRM" upgrade. The `PreferredCommunicationCell` hover-card now renders a full B2B contact card for `leadType = "professional"` rows: contact name, role/title, organisation name, **relationship classifier** (Primary Decision-Maker Contact / Departmental Contact / General Operations Contact) and **email-type label** (Personal / Departmental / Generic). Individual (B2C) rows are unchanged — they keep the original masked-by-default address with reveal/copy controls.

**Schema:** `prelaunch_leads` gained two nullable text columns — `representative_role` and `representative_relationship` — populated by the import pipeline / manual edit. When NULL, the hover-card derives sensible fallbacks via `lib/b2bContactIntelligence.ts`: role falls back from `organizationType` (e.g. `law_firm` → "Partner / Attorney"); relationship is inferred from the email local-part (generic mailboxes like `info@`, `admin@`, `hr@` → "General Operations Contact"; locals matching the rep's name → "Primary Decision-Maker Contact"; everything else → "Departmental Contact"). Free-mail domains are always classified as personal regardless of local-part because there are no shared inboxes on `gmail.com` etc.

**API contract:** `AdminLeadListItem` extended with `representativeName`, `representativeEmail`, `representativeRole`, `representativeRelationship`, `firmSize`, `serviceFocus` so the slim list endpoint carries enough rep info to render the tooltip without N+1 fetches. The full `Lead` schema also gained the two new role/relationship fields. **Public `POST /api/leads` insert path was not touched** — new columns rely on DB nullability.

### Phase 5 — Executive Dashboard / CRM Operations

Shipped as one brief; only the surviving end-state is documented here. Iteration history (chrome v1 → v2 → v3 → v3.1 / sidebar+launcher hybrid → sidebarless) lives in git. The chrome layer itself is captured under "Admin Layout Shell" above.

**Data model:** `prelaunch_leads` gained `lead_type` (NOT NULL DEFAULT 'individual'; `individual` vs `professional`), `inquiry_type` (`visa_inquiry` | `overstay_appeal` | `travel_entry_assistance`), `source` (DEFAULT 'web_form'), `assigned_to` (uuid soft-ref to `admin_users.id`, validated at API layer — no FK), `last_contacted_at`, `next_follow_up_at`, `tags` (text[]), and 10 professional-lead columns (`organization_name`, `organization_type`, `representative_*`, `website`, `firm_size`, `operating_regions` text[], `service_focus`, `estimated_client_volume`). `admin_users` gained an explicit `role` column (`superadmin` | `admin` | `sales` | `operations` | `viewer`, NOT NULL DEFAULT 'admin') that coexists with the authoritative `is_superadmin` boolean used by `gateSuperadmin()`. The status enum extended from 7 → 10 (`new → reviewing → contacted → awaiting_response → engaged → qualified → proposal_sent → ready_for_case → converted → closed`); the three new statuses were inserted in funnel-monotonic positions so every `canAdvanceStatus` transition stays valid. Priority gained `critical` above `high`. **The public `POST /api/leads` insert path was not touched** — new columns rely on DB defaults / NULL. OpenAPI Lead schema extended with all new fields; two new sibling schemas (`AdminLeadListItem`, `PublicLead`) codify what the slim and public-safe endpoints actually return.

**CRM polish:** Read-side mapping in `lib/typeOfEnquiry.ts` collapses the visa-type column into 7 display categories (Overstay, Declared Undesirable, First Time Entry, Travel Assistance, Immigration Consultation, Professional Partnership, Enterprise Demo Request) — no DB enum change. `components/help-tooltip.tsx` (white-bg, dark-text Radix tooltip) on every leads-table column header. `PreferredCommunicationCell` uses Radix HoverCard for mask-by-default + Reveal/Hide + copy-to-clipboard. Table density: `py-3` rows, alternating `even:bg-muted/10`, hover row tint.

**Communications hub:** The standalone `/admin/campaigns` surface is gone. `/admin/communications` is a four-tab shell (Campaigns / Templates / System Notifications [V1 placeholder] / Reports), tab picked from the URL inside `pages/admin-communications.tsx`. Campaign editor/detail live at `/admin/communications/campaigns/:id/edit` and `:id`. Legacy `/admin/campaigns/*` paths are preserved as a `LegacyCampaignsRedirect` route in `App.tsx` that calls `setLocation(..., { replace: true })`. Reports panel reads `GET /api/admin/campaigns/stats`: campaigns by status, by channel, recipient totals, 10-row recent-activity feed. **Open/click metrics are intentionally NOT reported** — they require provider webhooks (Resend events / WhatsApp delivery receipts) that aren't wired; the panel includes a top-line note documenting that gap.

**Draft Templates:** New table `comm_templates` (`lib/db/src/schema/templates.ts`): id, name, category (text, 5 values: `promotional` / `system_update` / `new_feature` / `educational` / `customer_experience`), channel (text, `email` | `whatsapp`), subject (nullable, email-only), body, createdBy/updatedBy (uuid soft-refs to admin_users), createdAt/updatedAt, archivedAt (soft-delete). Routes under `/api/admin/templates` (list with `?category=`, `?channel=`, `?includeArchived=true` / create / get / patch / archive / unarchive / preview), all behind `requireAdminAuth`. **Email-channel invariant** enforced on BOTH create and patch (subject required if channel=email). **Channel is locked after create** — operator must clone to switch channels. **Archived templates are immutable** (PATCH returns 409); archive is soft-delete via `archivedAt = now()`. Preview renders against a fixed sample context (`Alex Mokoena` / `EMA-DEMO-0001` / `Acme Immigration Co`) and reuses `lib/campaignRender.ts` so the 4 supported tokens are the SAME in templates as in campaigns. Every mutation writes a `comm_template_*` row via `writeAudit`. Campaign editor's "Load from template" picker is channel-filtered, replaces subject+body, leaves audience+channel untouched, and only auto-promotes the campaign name if it's still `"Untitled campaign"`. **V1 limitation:** no version history — loading a template is a one-shot copy.

**Module routing (executive shell):** `App.tsx` wires (all behind `RequireAdminAuth`): `/admin` (Dashboard), `/admin/communications`, `/admin/import`, `/admin/exports`, `/admin/users` (superadmin only), `/admin/profile` (aka Settings), plus stubs `/admin/analytics`, `/admin/reports`, `/admin/subscriptions`, `/admin/support`, `/admin/pipelines` rendered by `pages/admin-stub.tsx` so launcher items never dead-click. Bulk CSV export lives at `/admin/exports` → `GET /api/leads/export.csv` with `credentials: "include"`. Per-row CSV/timeline/send-update actions on the leads table are unaffected.

**Responsiveness:** (1) Kanban pipeline drags on touch devices via the `drag-drop-touch` polyfill (~30kb, side-effect import in `lead-pipeline-board.tsx`) — bridges HTML5 `draggable` onto touch events; no-op on desktop mouse. (2) Five tables are explicitly `overflow-x-auto`-wrapped (admin-users admins table, communications Campaigns + Reports tables, campaign-detail recipients table, import mapping table). (3) `admin-import.tsx` preview-stats grid is `grid-cols-1 sm:grid-cols-3`. (4) Communications tab strip is `overflow-x-auto whitespace-nowrap` with a negative-margin/padding bleed so it scrolls horizontally inside page padding on <=375px viewports. **Deferred:** the 10-column leads table on `admin.tsx` keeps its own `overflow-x-auto` wrapper; column-priority hide / mobile card layout is out of scope.

## Product

*   Public-facing 5-step assessment for lead capture.
*   Optional document upload for leads (PDF, JPG, PNG, DOC, DOCX).
*   WhatsApp integration for lead contact and OTP verification.
*   Public status lookup using a reference number.
*   Email engagement system for confirmations and updates.
*   Lightweight administrative CRM for lead and case management.
*   Lead engagement tracking for outbound communication.
*   Case lifecycle management with forward-only status progression.
*   Inbound WhatsApp message processing via webhooks with intent detection.
*   OTP verification for lead creation.
*   Bulk campaign engine (email + WhatsApp) with audience query builder, unsubscribe registry, and reusable draft templates.

## User preferences

I prefer concise and accurate responses.
I like to work iteratively, meaning I prefer to discuss changes and review them in stages rather than having a large change implemented all at once.
Please ask for confirmation before making significant changes to the codebase or architectural decisions.
Ensure all solutions are robust and consider edge cases.

## Gotchas

These are the genuinely surprising things that will bite a future contributor. Stable patterns have been promoted into Architecture decisions above.

*   **WhatsApp Webhook is Fail-Closed:** Reverses the prior always-200-to-Twilio strategy. Missing/invalid signatures return 401 and Twilio will retry per its backoff schedule. Set `WHATSAPP_APP_SECRET` (preferred) or keep `TWILIO_AUTH_TOKEN` set; absence of both yields 503.
*   **Lead Honeypot Field:** The public form must NEVER render an input named `website`; the API silently rejects any submission whose body includes a non-empty `website` string (returns a synthetic 201 with id `00000000-…` and reference `EMA-PENDING-OK`). New form fields must avoid that name.
*   **Document Deletion Scope:** `DELETE /api/documents/:id` requires `leadId` scope and will reject requests without it.
*   **Step 7 Schema Optionality:** `wantsToUploadDocuments` is `.optional()` in the assessment zod schema even though the UI requires it. This is so that step 6's `type=submit` Continue button isn't silently blocked by zod-resolver before the user has even seen the gate. The Submit/Finalize buttons themselves enforce the choice via `disabled={!wantsDocs}`.
*   **DocumentUploader allow-list is server-side only:** The frontend MIME/extension allow-list has been removed (`accept="*/*"`) with a soft "PDF/JPG/PNG/DOC/DOCX processed fastest" hint; the server's allow-list in `routes/documents.ts` is the source of truth and surfaces rejection messages in the inline error banner.
*   **Autofill on WhatsApp input:** Chromium occasionally autofills the WhatsApp field despite attempts to defeat it; handled by clearing during tests.
*   **Legal Modals:** All legal modals currently display placeholder copy awaiting final review. (V1 limitation.)
*   **Orphaned Blobs:** Object storage blobs are not deleted when documents are removed. (V1 limitation.)

## Pointers

*   _Populate as you build_
