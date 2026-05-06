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

## Stack

*   **Frameworks:** Express 5 (backend), React (frontend)
*   **Runtime:** Node.js 24, TypeScript 5.9
*   **ORM:** Drizzle ORM
*   **Validation:** Zod
*   **Build Tool:** esbuild
*   **Database:** PostgreSQL

## Where things live

*   **Backend API Routes:** `api-server/src/routes/`
*   **Database Schema:** `api-server/src/db/schema.ts`
*   **OpenAPI Specification:** `openapi.yaml`
*   **Frontend Pages:** `artifacts/emigration-assist/src/pages/`
*   **Frontend Components:** `artifacts/emigration-assist/src/components/`
*   **Shared Utilities:** `api-server/src/lib/`, `artifacts/emigration-assist/src/lib/`
*   **CSS/Theming:** `artifacts/emigration-assist/src/index.css`
*   **Country Data:** `artifacts/emigration-assist/src/lib/countries.ts`

## Architecture decisions

*   **Forward-Only Status Funnels:** Both lead statuses and case statuses are designed as forward-only funnels, enforced both in the UI and server-side with HTTP 409 conflict responses on regression attempts.
*   **Idempotent Lead-to-Case Conversion:** Converting a lead to a case is an idempotent operation, ensuring no duplicate cases are created upon repeated attempts.
*   **OTP Verification with Fallback:** OTP requests prioritize WhatsApp, falling back to email on provider failure, and include a development code for non-production environments.
*   **Optimistic UI with Server-Side Validation:** Admin CRM features use optimistic UI updates for responsiveness, with server-side re-validation and rollback for critical actions like status changes.
*   **Minimal PII in Public APIs:** Public endpoints for status lookup generalize information and avoid revealing Personally Identifiable Information, complemented by robust enumeration defense and rate limiting.
*   **Two-Phase Lead Submission (V3):** The lead row is committed at end of step 6 (Terms) with `finalize:false` (no email/WhatsApp dispatched); the confirmation is sent only when `POST /api/leads/:id/finalize` is called at the very end of the flow. The finalize route is at-most-once: it skips dispatch if any `lead_engagements` row of type `confirmation` already exists for the lead, bounding the abuse surface of the unauthenticated endpoint.
*   **Dynamic Assessment Step Count:** The assessment is 7 steps when the user opts out of supporting documents, 8 when they opt in. The Yes/No "do you have supporting documents to upload?" gate sits between Terms and Upload/Summary.
*   **Session-Scoped Document Listing:** `DocumentUploader` accepts a `sessionStartedAt` cutoff and filters out documents created before that moment, so a returning user (same email/whatsapp → dedup match on the existing lead) never sees documents from a previous session.
*   **Inside/Outside-SA Residence Logic:** When the user picks "outside South Africa" the residence dropdown excludes ZA via `excludeIso`. When they pick "inside" with an empty residence, ZA is auto-selected; when they switch from a ZA residence back to "outside", ZA is cleared.
*   **Admin Auth (V3 — email + password):** `admin_users`, `admin_sessions`, `admin_password_resets` tables in `lib/db/src/schema/admin.ts`. Login mints an opaque session id stored server-side and set as the httpOnly `ema_admin_session` cookie (7-day TTL, sameSite=lax, secure in prod). The shared `requireAdminAuth` / `requireAdminToken` middleware checks the cookie first and falls back to the legacy `x-admin-token` header so operator scripts keep working. On startup, if `admin_users` is empty, a demo admin (`demo@admin.local` / `ChangeMe!2026`, override via `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`) is seeded as superadmin and the credentials are logged at WARN. Forgot-password mints a 1-hour single-use token (sha256-hashed in DB) emailed via Resend; "Manage Admins" (`/admin/users`) is superadmin-only and includes a self-protection guard so a superadmin can't disable/demote/delete themselves.

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

## User preferences

I prefer concise and accurate responses.
I like to work iteratively, meaning I prefer to discuss changes and review them in stages rather than having a large change implemented all at once.
Please ask for confirmation before making significant changes to the codebase or architectural decisions.
Ensure all solutions are robust and consider edge cases.

## Gotchas

*   **Document Deletion Scope:** `DELETE /api/documents/:id` requires `leadId` scope and will reject requests without it.
*   **Legal Modals:** All legal modals currently display placeholder copy awaiting final review.
*   **Orphaned Blobs:** Object storage blobs are not deleted when documents are removed (V1 limitation).
*   **Autofill:** Chromium occasionally autofills WhatsApp input despite attempts to defeat it; handled by clearing during tests.
*   **`POST /api/leads` `finalize` Flag:** Defaults to `true` for back-compat. The web frontend always passes `finalize:false` from the assessment so the confirmation isn't sent until `/finalize` is hit. Any new caller must remember to pass `finalize:false` if it intends to defer the dispatch.
*   **Legacy `adminToken.ts` Shim:** `getAdminToken()` now returns the placeholder string `"cookie-auth"` so the many existing fetch sites keep their `if (!token) return;` guards green and the (irrelevant) header is harmless server-side. `clearAdminToken()` redirects to `/admin/login`. Real auth is the session cookie. New admin fetches should use `credentials: "include"` and skip the token helper entirely.
*   **Step 7 Schema Optionality:** `wantsToUploadDocuments` is `.optional()` in the assessment zod schema even though the UI requires it. This is so that step 6's `type=submit` Continue button isn't silently blocked by zod-resolver before the user has even seen the gate. The Submit/Finalize buttons themselves enforce the choice via `disabled={!wantsDocs}`.

## Pointers

*   _Populate as you build_