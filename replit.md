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
*   **Lead Engagement Tracking:** A `lead_engagements` table records all outbound communication attempts (email, WhatsApp) with auditable statuses.
    *   Non-blocking on lead submission and channel-agnostic `sendMessage` gateway.
    *   WhatsApp channel uses **Twilio Programmable Messaging**.
    *   Confirmation dispatch is preference-aware, using WhatsApp if preferred and available, otherwise email.
    *   Resubmissions trigger fresh confirmations after a 1-minute per-channel cooldown.
    *   Admin endpoints for manual updates and viewing engagement history are token-gated.
*   **Inbound WhatsApp Webhook:** `POST /api/webhooks/whatsapp` receives Twilio event payloads, stores inbound messages in `case_messages` table, and responds immediately with 200. Includes signature verification.
    *   Deterministic keyword intent detection (`"done", "uploaded", "sent"`) sets `intent='task_complete_signal'`.
    *   Admin endpoint `GET /api/admin/leads/:id/messages` returns inbound messages.
*   **Security:** Uses UUIDs for document access, `x-admin-token` for admin endpoint security with constant-time comparisons, and rate limiting for public and admin endpoints. PII is minimized in logs and public APIs.

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