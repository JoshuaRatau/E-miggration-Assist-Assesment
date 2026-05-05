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
    *   Canonical lowercase enums (`leadStatus`, `leadPriority`) are used.
    *   `leadPriority` is auto-assigned on insert based on situation and visa history but not overwritten on re-submission.
    *   `PATCH /api/admin/leads/:id` endpoint for updating lead status, priority, and notes, protected by `x-admin-token`. This endpoint and document endpoints are not in the OpenAPI spec due to custom header requirements or incompatible types for Orval.
    *   Optimistic UI updates for inline editing in the admin interface.
*   **Lead Engagement Tracking:** A `lead_engagements` table records all outbound communication attempts (email, WhatsApp).
    *   Guarantees: non-blocking on lead submission, auditable send attempts (pending/sent/failed statuses), no PII in logs.
    *   Channel-agnostic `sendMessage` gateway with structured results for success, transient failure, or permanent failure. The WhatsApp channel posts to the WhatsApp Business Cloud API (Meta Graph `v21.0/{PHONE_NUMBER_ID}/messages`) and lazy-reads `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_TOKEN` on every call (no startup caching). When either secret is missing the engagement is marked `failed` with reason `not_configured`. HTTP 5xx/429/network errors are transient (engagement → `pending`); 4xx are permanent (`failed`). Free-form text only — pre-approved Message Templates are a future-only addition to `lib/whatsappClient.ts`.
    *   Confirmation dispatch is **preference-aware**: when a lead's `preferredContactMethod` is `whatsapp` AND a whatsapp number is on file, the confirmation message is sent via WhatsApp instead of email. Otherwise the email path is used. If there's no email but a whatsapp number exists, whatsapp is used regardless of preference (better to reach the lead via the only contact we have than to silently skip). Both channels share the same body via `composeConfirmationBody()` in `lib/email.ts` — a client-facing note addressed to the lead by name confirming their submission was received and that a consultant will be in touch, with the reference number at the bottom for follow-up.
    *   Admin endpoints to send manual updates (`POST /api/admin/leads/:id/send-update`) and view engagement history (`GET /api/admin/leads/:id/engagements`), both token-gated.
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