# Overview

This project is a pnpm workspace monorepo using TypeScript, designed to support an immigration-help service called E-Migration Assist. It features a public-facing lead capture system and a lightweight administrative CRM. The primary goal is to provide a seamless pre-launch experience for potential clients, offering a 5-step assessment that creates a lead and captures essential information, including optional document uploads and WhatsApp contact details.

The system emphasizes careful communication, avoiding legal jargon and promises. It also includes features for public status lookups and silent email engagements. The administrative CRM allows the operations team to manage leads, track engagement, and update lead statuses and priorities. The project aims to be multi-channel ready for future communication expansions.

# User Preferences

I prefer concise and accurate responses.
I like to work iteratively, meaning I prefer to discuss changes and review them in stages rather than having a large change implemented all at once.
Please ask for confirmation before making significant changes to the codebase or architectural decisions.
Ensure all solutions are robust and consider edge cases.

# System Architecture

The project is structured as a pnpm monorepo using Node.js 24 and TypeScript 5.9. The backend API is built with Express 5, interacting with a PostgreSQL database via Drizzle ORM. Zod is used for validation, and Orval generates API hooks from an OpenAPI specification. `esbuild` is used for CJS bundle compilation.

**Key Features and Implementations:**

*   **Lead Capture & Assessment:** A 5-step public assessment form creates leads. Lawyer-vetted copy ensures compliance.
*   **Document Upload:** Optional step for leads to upload PDF, JPG, PNG files (max 10MB) after lead creation. Files are stored in Replit Object Storage, with server-side proxying for uploads and downloads to ensure privacy and validation (magic bytes, size limits). Nine fixed document types are supported.
*   **WhatsApp Integration:** An optional WhatsApp number field is captured, normalized (`+XXXXXXXXXXX` format), and validated server-side. Duplicate detection uses the canonical WhatsApp number.
*   **Public Status Lookup:** A `GET /api/public/status/:referenceNumber` endpoint allows users to check their case status. It provides a generalized `publicLabel` based on internal classification, intentionally excluding PII and internal CRM fields. Robust enumeration defense and rate limiting are implemented.
*   **Email Engagement System:** Uses Resend for sending pre-launch confirmation and manual update emails.
    *   Emails are screened against forbidden phrases (e.g., "approved," "guaranteed") and call-to-action phrases.
    *   Email sending is non-blocking; lead submission never waits for email delivery.
    *   `ADMIN_EMAIL_TOKEN` is used for securing admin email endpoints, failing closed if unset.
*   **Admin Lead Management CRM:** A lightweight CRM for operations.
    *   Canonical lowercase enums (`leadStatus`, `leadPriority`) are used. Allowed `leadStatus` values: `new | reviewing | contacted | qualified | converted | closed`. (`qualified` was added as the post-contact CRM hand-off step.)
    *   `leadPriority` is auto-assigned on insert based on situation and visa history but not overwritten on re-submission.
    *   `PATCH /api/admin/leads/:id` endpoint for updating lead status, priority, and notes, protected by `x-admin-token`. This endpoint and document endpoints are not in the OpenAPI spec due to custom header requirements or incompatible types for Orval.
    *   **Admin auth is enforced on every endpoint that returns CRM/PII data**: `GET /api/leads` (list), `GET /api/leads/by-id/:id` (single-lead detail with full PII), and `GET /api/leads/export.csv` all require the `x-admin-token` header via the shared `requireAdminToken` helper in `lib/adminAuth.ts`. The public reference lookup (`GET /api/leads/:referenceNumber`) remains open but uses a `serializeLeadPublic` view that strips PII and rules-engine data.
    *   **Lead Dashboard at `/admin`** (`pages/admin.tsx`): single table with Name (+ ref subline) | Visa Type | WhatsApp (✔/✖) | Status (inline dropdown) | Priority (color-coded inline dropdown — high=red, medium=orange, low=grey) | Created | Actions. Three filters (Status, Priority, WhatsApp) plus a Sort toggle (newest / priority-first). Empty state differentiates "No leads yet" vs "No leads match the current filters." The list endpoint serializes via `serializeLeadAdminList`, which intentionally omits rules-engine fields (`leadScore`, `internalClassification`, `leadCategory`, `adminNotes`) per the "do not expose rules engine data" rule.
    *   The admin pages send `x-admin-token` via custom React Query hooks (not Orval's generated hooks, since those have no header-injection point). The token is read from sessionStorage (`ema-admin-token`) with a `window.prompt` fallback. CSV export uses `fetch` + Blob download to keep the token in a header instead of the URL.
    *   Optimistic UI updates for inline editing — `patchLead` snapshots the single mutating row, applies the change to the `["admin","leads",serverParams]` cache, rolls back per-row on failure, and invalidates the list to reconcile filter-affecting changes.
*   **Lead Engagement Tracking:** A `lead_engagements` table records all outbound communication attempts (email, WhatsApp).
    *   Guarantees: non-blocking on lead submission, auditable send attempts (pending/sent/failed statuses), no PII in logs.
    *   Channel-agnostic `sendMessage` gateway with structured results for success, transient failure, or permanent failure. The WhatsApp channel posts to **Twilio Programmable Messaging** via the official `twilio` SDK (`client.messages.create`) and lazy-reads `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM` on every call (no startup caching). When any of those secrets is missing the engagement is marked `failed` with reason `not_configured`. HTTP 5xx/429 from Twilio AND Node transport errors (`ETIMEDOUT`, `ECONNRESET`, etc.) are transient (engagement → `pending`); known Twilio 4xx codes are permanent (`failed`). Free-form text only — pre-approved Content Templates are a future-only addition to `lib/whatsappClient.ts`.
    *   Confirmation dispatch is **preference-aware**: when a lead's `preferredContactMethod` is `whatsapp` AND a whatsapp number is on file, the confirmation message is sent via WhatsApp instead of email. Otherwise the email path is used. If there's no email but a whatsapp number exists, whatsapp is used regardless of preference (better to reach the lead via the only contact we have than to silently skip). Both channels share the same body via `composeConfirmationBody()` in `lib/email.ts` — a client-facing note addressed to the lead by name confirming their submission was received and that a consultant will be in touch, with the reference number at the bottom for follow-up.
    *   **Resubmissions are confirmed too**: when a duplicate submission is detected (matching email or whatsapp), the existing lead is updated AND a fresh confirmation is dispatched on the (possibly updated) preferred channel. A 1-minute per-channel cooldown suppresses accidental double-click spam — only `status='sent'` deliveries block a retry, so a previous failed/pending attempt never prevents a fresh send.
    *   Admin endpoints to send manual updates (`POST /api/admin/leads/:id/send-update`) and view engagement history (`GET /api/admin/leads/:id/engagements`), both token-gated.
*   **Inbound WhatsApp Webhook (Phase 1 — deterministic):** Inbound replies from leads are received via Twilio's webhook delivery and stored for operator review. `lib/whatsappClient.ts` accepts recipients in `+E164`, `E164`, or `whatsapp:+E164` form and normalises once (validating the phone shape after stripping any prefix). Twilio error codes are mapped to actionable reasons (`invalid_credentials`, `recipient_not_joined_sandbox`, `outside_session_window`, `recipient_unsubscribed`, `invalid_recipient`).
    *   `POST /api/webhooks/whatsapp` — receives Twilio form-encoded event payloads. ALWAYS responds 200 with empty TwiML (`<Response/>`) so Twilio doesn't retry and doesn't auto-reply. **Persist-before-ack**: the durable `case_messages` insert is `await`ed BEFORE the 200 response (a crash between ack and persist would lose the message permanently — Twilio does not retry 2xx). Non-durable side effects (analytics insert, `reconcileNextActionsForCase`) remain fire-and-forget so they cannot delay the ack past Twilio's 15s deadline. Signature verification uses `X-Twilio-Signature` = base64(HMAC-SHA1(URL + sortedConcat(key,value), authToken)) via the official `twilio.validateRequest` helper. The signed URL is reconstructed as `https://<x-forwarded-host or host><req.originalUrl>` because Replit's reverse proxy terminates TLS — `app.set('trust proxy', true)` is enabled.
    *   No GET handshake — Twilio doesn't have one (unlike Meta). Just save the URL in the Twilio Console and it starts POSTing.
    *   Inbound messages are stored in the `case_messages` table (`lead_id`, `direction='inbound'`, `wa_message_id` UNIQUE [stores the Twilio MessageSid] for idempotency, `message`, `intent`, `matched_keyword`). Lead matching is by canonical WhatsApp number via `normalizeWhatsapp`; unknown numbers are dropped with an info log.
    *   **Deterministic keyword intent detection** (no LLM yet): whole-word match against `["done", "uploaded", "sent"]`. A match sets `intent='task_complete_signal'` and records the matched keyword. Non-matching messages are stored verbatim with `intent=null` (the operator sees them in the timeline).
    *   `reconcileNextActionsForCase()` is a STUB that logs the signal but does not mutate state — there is no task/next-action data model in this codebase yet. The signal is durably stored on the message row for replay when the task model is added.
    *   Admin endpoint `GET /api/admin/leads/:id/messages` (token-gated) returns inbound messages newest-first; the admin lead-detail page renders them in an `InboundMessages` card above the outbound `EngagementHistory`, with a green "completion signal" badge when intent fired.
    *   Required secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (e.g. `whatsapp:+14155238886` for the Sandbox sender). Sandbox recipients must first send `join <sandbox-keyword>` to that number — error code 63007 → reason `recipient_not_joined_sandbox` flags this.
*   **Security:** UUIDs are used for document access with sufficient entropy. Admin endpoints are secured using an `x-admin-token` header and constant-time comparisons. Rate limiting is applied to public status lookup and admin email endpoints. PII is minimized in logs and public API responses.

# External Dependencies

*   **pnpm:** Monorepo management.
*   **Node.js:** Runtime environment (v24).
*   **TypeScript:** Programming language (v5.9).
*   **Express:** API framework (v5).
*   **PostgreSQL:** Primary database.
*   **Drizzle ORM:** Object-relational mapper for PostgreSQL.
*   **Zod:** Schema validation (`zod/v4`).
*   **drizzle-zod:** Zod integration for Drizzle.
*   **Orval:** OpenAPI client code generator.
*   **esbuild:** Bundler for CJS output.
*   **Replit Object Storage:** For storing uploaded documents.
*   **Resend:** Email sending service (accessed via Replit integration).
*   **file-type:** Library for validating file magic bytes.
*   **Multer:** Middleware for handling `multipart/form-data` (used with `memoryStorage`).