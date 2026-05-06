# Overview

This project is a pnpm workspace monorepo using TypeScript, designed to support E-Migration Assist, an immigration-help service. It features a public-facing lead capture system with a 5-step assessment, optional document uploads, and WhatsApp contact integration. The system aims to provide a seamless pre-launch experience, generate leads, and capture essential information while avoiding legal jargon. It also includes a lightweight administrative CRM for managing leads, tracking engagement, and updating statuses, along with features for public status lookups and silent email engagements. The project is designed for future multi-channel communication expansion.

# User Preferences

I prefer concise and accurate responses.
I like to work iteratively, meaning I prefer to discuss changes and review them in stages rather than having a large change implemented all at once.
Please ask for confirmation before making significant changes to the codebase or architectural decisions.
Ensure all solutions are robust and consider edge cases.

# System Architecture

The project is structured as a pnpm monorepo using Node.js 24 and TypeScript 5.9. The backend API is built with Express 5, interacting with a PostgreSQL database via Drizzle ORM. Zod is used for validation, and Orval generates API hooks from an OpenAPI specification. `esbuild` is used for CJS bundle compilation.

**Core Architectural Decisions and Features:**

*   **Lead Capture & Assessment:** A 5-step public assessment form creates leads, designed with lawyer-vetted copy.
    *   **Country pickers (V1, frontend-only):** Nationality and Current Country of Residence are searchable comboboxes (Radix Popover + cmdk Command) backed by `artifacts/emigration-assist/src/lib/countries.ts` (~240 ISO 3166-1 entries: name, ISO2, dial code, flag emoji helper). Form still submits the country **name** to the backend (`nationality`, `countryOfResidence`) — no schema/OpenAPI change. Components: `src/components/country-combobox.tsx`. Default WhatsApp country = South Africa (DEFAULT_DIAL_ISO="ZA").
    *   **WhatsApp input (V1, frontend-only):** `src/components/whatsapp-input.tsx` = dial-country combobox (`data-testid="whatsapp-country"`) + read-only `+<dial>` badge + tel input (`data-testid="input-whatsapp"`). State is fully component-owned (no resync from form value mid-typing — that earlier caused the leading-0 strip to wipe the input). On every keystroke / country change, the form receives canonical E.164 (`+<dial><digits-with-leading-0s-stripped>`); empty input → empty form value (still optional). Zod refine on `whatsapp` simplified to `/^\+\d{8,15}$/`. Autofill defeated with `autoComplete="new-password"`, randomized `name`, `data-lpignore`, `data-form-type="other"` (Chromium still occasionally autofills — handled at test time by clearing). DB column unchanged (`prelaunch_leads.whatsapp text`).
*   **Document Upload:** Optional feature for leads to upload PDF, JPG, PNG files (max 10MB) after lead creation, stored in Replit Object Storage. Server-side proxying ensures validation (magic bytes, size limits) and privacy.
*   **WhatsApp Integration:** Captures, normalizes, and validates optional WhatsApp numbers. Duplicate detection uses canonical WhatsApp numbers.
*   **Public Status Lookup:** A `GET /api/public/status/:referenceNumber` endpoint allows users to check their case status, providing a generalized `publicLabel` without PII. Includes robust enumeration defense and rate limiting.
*   **Email Engagement System:** Uses Resend for sending pre-launch confirmation and manual update emails. Emails are screened for forbidden phrases, and sending is non-blocking. `ADMIN_EMAIL_TOKEN` secures admin email endpoints.
*   **Admin Lead Management CRM:** A lightweight CRM for operations.
    *   Uses canonical lowercase enums for `leadStatus` (`new | reviewing | contacted | qualified | converted | closed`) and `leadPriority`.
    *   `PATCH /api/admin/leads/:id` for updating lead status, priority, and notes, protected by `x-admin-token`.
    *   Admin authentication (`x-admin-token`) is enforced on all endpoints returning CRM/PII data.
    *   **Lead Dashboard (`/admin`):** Displays leads with filters, sorting, and inline editing for status and priority. Optimistic UI updates are used for a responsive experience.
    *   **Lead Action Layer (Conversion Engine V1):** Derives a `nextStep` for each lead based on its status, influencing display and quick actions.
    *   **Contact Quick-Action Button:** Allows one-click outbound contact via WhatsApp or email, auto-advancing lead status to `contacted` for `new` or `reviewing` leads.
    *   **Lead status funnel (forward-only, V2):** Canonical order in `LEAD_STATUS_VALUES` (lib/classification.ts): `new → reviewing → contacted → qualified → ready_for_case → converted → closed`. `ready_for_case` (added V2) sits between `qualified` and `converted` — semantically "all checks passed, awaiting handover" (next step: "Initiate case handover"). The funnel is **forward-only**: `canAdvanceStatus(from, to)` returns true only when `to.index >= from.index`. Server-side enforcement in `PATCH /api/admin/leads/:id` fetches the lead's current status when `status` is in the body and rejects regressions with **HTTP 409** plus an explanatory error listing the allowed order. Same-status PATCHes are no-ops so optimistic-UI retries are safe. Frontend mirror in `artifacts/emigration-assist/src/lib/leadStatus.ts` (`LEAD_STATUS_ORDER`, `canAdvanceStatus`, `isStrictlyUpstreamOf`, `statusLabel`) is used by both `pages/admin.tsx` (per-row inline Status dropdown) and `pages/admin-lead-detail.tsx` (full detail editor) to **disable backward options** with a `"Forward-only funnel — cannot regress"` tooltip. The Contact button's previous `CONTACTED_OR_LATER` set is replaced by `isStrictlyUpstreamOf(status, "contacted")` so adding new statuses doesn't require updating the contact-skip guard. The DB column remains `text` (no enum migration; legacy values are accepted as the floor for forward-only checks).
*   **Lead Engagement Tracking:** A `lead_engagements` table records all outbound communication attempts (email, WhatsApp) with auditable statuses.
    *   Non-blocking on lead submission and channel-agnostic `sendMessage` gateway.
    *   WhatsApp channel uses **Twilio Programmable Messaging**.
    *   Confirmation dispatch is preference-aware, using WhatsApp if preferred and available, otherwise email.
    *   Resubmissions trigger fresh confirmations after a 1-minute per-channel cooldown.
    *   Admin endpoints for manual updates and viewing engagement history are token-gated.
*   **Lead → Case Conversion (V1):** When a lead reaches `leadStatus="converted"`, an idempotent `lead_cases` row is created.
    *   `lead_cases` table: `id`, `lead_id UUID UNIQUE`, `reference_number` (snapshot of the lead's ref at conversion), `status TEXT default "initiated"`, timestamps. The unique `lead_id` is the idempotency primitive.
    *   `ensureCaseForLead()` (`api-server/src/lib/cases.ts`) uses `INSERT … ON CONFLICT (lead_id) DO NOTHING RETURNING` + fallback `SELECT`, safe under concurrent PATCHes.
    *   `PATCH /api/admin/leads/:id` calls `ensureCaseForLead` whenever the resulting `leadStatus === "converted"` (every time, not only on status change — so notes-only edits on already-converted leads still surface `caseId`); fails the request with HTTP 500 if case creation errors.
    *   `Lead` payloads (list + detail + PATCH response) carry `caseId: string | null`, populated via `LEFT JOIN lead_cases` for GETs and from `ensureCaseForLead` for PATCH. `openapi.yaml` Lead schema includes `caseId`.
    *   Admin endpoint `GET /api/admin/cases/:caseId` returns case + embedded lead snapshot (admin-token gated, NOT modelled in OpenAPI — uses raw fetch from frontend, mirroring the PATCH convention).
    *   Frontend: `/admin` row actions render **"Convert to Case"** when `leadStatus === "ready_for_case"` (PATCHes to `converted` then deep-links to `/admin/case/:caseId` from the response) and **"Open Case"** when `leadStatus === "converted"` (link only). New page `/admin/case/:caseId` (`pages/admin-case-detail.tsx`) shows case ref, case status, lead status, next step, original lead snapshot, and notes.
    *   **Note (intentional):** server allows `converted` from any forward status (consistent with existing forward-only funnel semantics — no per-step staging). The `ready_for_case` gate is UI-only.
*   **Case Lifecycle (V1):** Forward-only stages on `lead_cases.status` (text column, no enum migration).
    *   Canonical order in `CASE_STATUS_VALUES` (`api-server/src/lib/caseStatus.ts`): `initiated → in_review → documents_requested → submitted → closed`. Frontend mirror in `artifacts/emigration-assist/src/lib/caseStatus.ts`.
    *   `PATCH /api/admin/cases/:caseId` (admin-token gated, NOT in OpenAPI — raw fetch from frontend) advances case status. Forward-only guard is encoded ATOMICALLY in the UPDATE WHERE predicate (same TOCTOU-closing pattern as the lead funnel guard); regression returns **HTTP 409** with the canonical order; nonexistent case → 404; same-status PATCH is a 200 no-op so optimistic-UI retries are safe; legacy non-enum values are passed through (never lock a row).
    *   Frontend: `/admin/case/:caseId` renders a `Select` next to the status badge; backwards options are disabled with a `"Forward-only lifecycle — cannot regress"` tooltip. Optimistic update with rollback on 409/error.
*   **Inbound WhatsApp Webhook:** `POST /api/webhooks/whatsapp` receives Twilio event payloads, stores inbound messages in `case_messages` table, and responds immediately with 200. Includes signature verification.
    *   Deterministic keyword intent detection (`"done", "uploaded", "sent"`) sets `intent='task_complete_signal'`.
    *   Admin endpoint `GET /api/admin/leads/:id/messages` returns inbound messages.
*   **Security:** Uses UUIDs for document access, `x-admin-token` for admin endpoint security with constant-time comparisons, and rate limiting for public and admin endpoints. PII is minimized in logs and public APIs.
*   **Branding (eRide Technologies):** App is mono-mode dark navy (`213 60% 9%`) + teal accent (`187 38% 52%`). Palette tokens live in `artifacts/emigration-assist/src/index.css` `:root` (and mirrored in `.dark` as an alias). Shared `BrandHeader` component (`src/components/brand-header.tsx`) renders the eRide wordmark + "E-Migration Assist" title and is mounted at the top of every page (home, status, assessment, thank-you, admin, admin-lead-detail, admin-case-detail). Logo asset: `public/eride-logo-light.png` (white-fuzz transparent PNG derived from `attached_assets/logo-eride-tech_*.pdf`). Favicon at `public/favicon.svg` is a navy + teal mark.

# External Dependencies

*   **pnpm:** Monorepo management.
*   **Node.js:** Runtime environment (v24).
*   **TypeScript:** Programming language (v5.9).
*   **Express:** API framework (v5).
*   **PostgreSQL:** Primary database.
*   **Drizzle ORM:** Object-relational mapper.
*   **Zod:** Schema validation.
*   **drizzle-zod:** Zod integration for Drizzle.
*   **Orval:** OpenAPI client code generator.
*   **esbuild:** Bundler.
*   **Replit Object Storage:** For document storage.
*   **Resend:** Email sending service.
*   **file-type:** For validating file magic bytes.
*   **Multer:** Middleware for `multipart/form-data` handling.
*   **Twilio Programmable Messaging:** For WhatsApp integration.