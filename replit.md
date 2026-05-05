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

### OpenAPI spec note

Most endpoints are defined in `lib/api-spec/openapi.yaml` and consumed via
generated React Query hooks. The two document endpoints
`POST /api/documents/upload` (multipart) and
`GET /api/documents/{id}/download` (binary) are intentionally **not** in the
spec — Orval cannot generate usable types for them. They are documented in a
description block on `GET /documents` and called by the client with plain
`fetch` / anchor `href`.
