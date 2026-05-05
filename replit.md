# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## E-Migration Assist (artifacts/emigration-assist + artifacts/api-server)

Pre-launch lead capture + lightweight admin CRM for an immigration-help service.
Public site is a 5-step assessment that creates a lead and shows a public-safe
"Preliminary Assessment Recorded" page. Lawyer-vetted copy: never uses the
words approved/rejected/qualify/guaranteed/"we will fix"/"Home Affairs will".
There are no apply / pay / submit-for-review CTAs.

### Document upload (added)

- Optional **step 5** of `/assessment` lets a lead attach supporting docs
  AFTER the lead row is created (not blocking submission).
- The admin lead detail page has a **Documents** card that shows the same
  uploader and a list of every file the lead has attached.
- Storage: Replit Object Storage. The API server obtains a presigned URL
  (`getObjectEntityUploadURL`), streams the file to GCS server-side, then
  stores the normalized object path in `prelaunch_documents.fileUrl`. Files
  are private; download is proxied via `/api/documents/:id/download` which
  streams bytes back through `objectFile.createReadStream()`.
- Allowed types: PDF, JPG, PNG. Max 10MB. Server validates magic bytes with
  `file-type` and rejects content/type mismatch with 415. Multer is configured
  with memoryStorage and a 10MB hard limit (413 on overflow).
- 9 fixed document types: passport, visa_permit, entry_stamp, exit_stamp,
  undesirable_declaration, medical_evidence, travel_evidence,
  written_explanation, other.
- All three document endpoints validate UUIDs with zod and return 400 on bad
  input.
- **No auth** on document endpoints — this matches the rest of the app
  (admin endpoints are also unauthenticated). Document UUIDs are random v4
  (~122 bits of entropy) and never exposed publicly. If/when admin auth is
  added, mount it on the `/api/documents` router as well.

### Public vs internal data

`serializeLeadPublic` (in `artifacts/api-server/src/routes/leads.ts`) is the
single source of truth for the public `/api/leads/:reference` payload. It
deliberately excludes every internal CRM field (`leadStatus`, `leadScore`,
`leadPriority`, `internalClassification`, `adminNotes`) and contact PII the
lookup page does not need. Do not add new fields to it without legal review.

### Public status lookup (added)

Returning users can check their case via reference number.

- **Endpoint:** `GET /api/public/status/:referenceNumber` (router file
  `artifacts/api-server/src/routes/publicStatus.ts`).
- **Response shape** (locked, see `PublicStatus` schema in OpenAPI):
  `{ referenceNumber, publicLabel, createdAt, documentsUploaded }`. Every
  internal CRM field, score, priority, classification and contact PII is
  intentionally excluded.
- **publicLabel** is one of four neutral strings, mapped from the internal
  classification:
   - `VALID_STATUS_GENERAL_INTEREST` → "Assessment Received"
   - `OVERSTAY_STRONG_CONTEXT`, `OVERSTAY_MODERATE_CONTEXT` → "Supporting Circumstances Present"
   - `VISA_EXPIRING_OR_EXPIRED`, `OVERSTAY_LIMITED_CONTEXT`, `UNKNOWN_REQUIRES_REVIEW` → "Requires Further Review"
   - `DECLARED_UNDESIRABLE`, `POSSIBLE_PROHIBITED_PERSON` → "High Complexity Case"
- **Format validation:** the route accepts only references matching
  `^EMA-[A-Z0-9]{2,16}-[A-Z0-9]{2,8}$` (case insensitive — the path is
  uppercased before lookup).
- **Enumeration defence:** malformed references and unknown references both
  return the identical generic 404 `{"error":"Reference not found"}` so a
  caller cannot tell them apart.
- **Rate limit:** in-memory sliding window, 10 requests / 60s per IP, with
  `Retry-After` header on 429. Implemented inline (no extra deps); a periodic
  `setInterval(...).unref()` evicts stale entries.
- **UI:** `/status` calls the new `useGetPublicStatus` hook and renders the
  case status, the date, a documents indicator
  ("Supporting documents received" or "No documents uploaded yet"), and the
  fixed sentence "This is your current assessment status. You may be
  contacted when the full platform becomes available." The thank-you page
  ends with a "Check Status" button and a save-your-reference instruction.

### Silent engagement email (added)

Pre-launch confirmation + manual update emails via Resend.

- **Provider:** Resend, wired through the Replit integration
  (`searchIntegrations("resend")`). Credentials are fetched at runtime from
  `connectors.replit.com /api/v2/connection?connector_names=resend` — never
  cached client-side, never stored in env vars. The `from_email` configured on
  the connection is preferred; if absent we fall back to the spec value
  `no-reply@eridetech.africa`. Display name is `E-Migration Assist`.
- **Email module:** `artifacts/api-server/src/lib/email.ts` exposes
  `sendConfirmationEmail` and `sendUpdateEmail`. Both go through the shared
  `sendSafely()` helper which (a) screens the subject + body against the
  forbidden-phrase regexes (`approved`, `rejected`, `guaranteed`,
  `you qualify`, `we will fix`, `Home Affairs will`) **and** the no-CTA
  phrases (`apply now`, `book consultation`, `pay now`, `contact agent`),
  refusing to send if any match; (b) catches every Resend error and returns a
  `{ ok: false, reason }` shape so callers never throw.
- **Confirmation trigger:** Inside `POST /api/leads`, after the insert
  succeeds, a fire-and-forget IIFE sends the confirmation when both
  `inserted.email` and `inserted.consentAccepted` are truthy. **Lead
  submission must never block on email**, so the IIFE swallows everything and
  logs via `req.log.warn`. The duplicate-update branch deliberately does
  **not** re-send a confirmation.
- **Manual update batch:** `POST /api/admin/email/update`
  (`artifacts/api-server/src/routes/adminEmail.ts`) selects every lead with
  `consent_accepted = true` and a non-empty `email`, sends the
  "Update on Your Assessment" body sequentially, and logs one
  `email_sent_update` analytics row per recipient.
- **Admin endpoint protection:** Unlike the rest of the admin surface this
  endpoint has external blast radius (recipient inboxes / sender reputation),
  so it is gated by an `ADMIN_EMAIL_TOKEN` secret. The handler **fails
  closed** (503) when the env var is unset, and rejects with 401 when the
  `x-admin-token` header is missing or wrong (constant-time compare). It also
  applies a per-IP 5-minute rate limit. The admin button prompts for the
  token on first use and caches it in `sessionStorage` (`ema-admin-token`);
  it clears the cache on a 401 so a wrong paste self-corrects.
- **Analytics events** (in `analytics_events`): `email_sent_confirmation` and
  `email_sent_update`, each with payload `{ success, messageId? , reason? }`
  and the originating `leadId` + `referenceNumber`. These are inserted
  directly via Drizzle (the `/analytics/events` validator does not allow them
  — they are server-internal events).
- **Consent text** (`assessment.tsx` step 4):
  "I agree to receive updates about my assessment and platform availability."
  The submission still rejects without `consentAccepted=true` (zod refine on
  the client; explicit 400 on the server).

### OpenAPI spec note

Most endpoints are defined in `lib/api-spec/openapi.yaml` and consumed via
generated React Query hooks. The two document endpoints
`POST /api/documents/upload` (multipart) and
`GET /api/documents/{id}/download` (binary) are intentionally **not** in the
spec — Orval cannot generate usable types for them. They are documented in a
description block on `GET /documents` and called by the client with plain
`fetch` / anchor `href`.
