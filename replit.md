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
*   `ADMIN_EMAIL_TOKEN`: Token for admin email endpoints
*   `RESEND_API_KEY`: Resend API key for email sending
*   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: Twilio credentials for WhatsApp
*   `OTP_SECRET`: Secret for OTP hashing
*   `REPLIT_OBJECT_STORAGE_URL`: Replit Object Storage endpoint

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

## Pointers

*   _Populate as you build_