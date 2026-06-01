---
name: Eride Support Hub ticket-ingest contract
description: Reverse-engineered external API for mirroring support tickets to eride-support-hub.replit.app (no source access)
---

# Eride Support Hub ticket ingest

External shared support wallboard at `https://eride-support-hub.replit.app`. We have **no source access** — the contract below was reverse-engineered from its frontend bundle. Treat it as brittle; the hub team can change it without notice.

## Endpoint
- `POST /api/support/tickets` — **PUBLIC, unauthenticated**. Returns 201 `{ticketReference, ticketNumber, id, publicStatus, productName, createdAt}`. Bad body → 400 with generic "Please check the form and try again." (NOT 401).
- `GET /api/support/tickets` — 401 admin-only.
- `GET /api/support/products` — public; lists products with `productCode` + UUID `id`.
- `EMIGRATION_WEBHOOK_SECRET` is for a *different* outbound "Hermes" webhook, NOT ticket ingest. Ingest needs no auth.

## Payload (must use these exact field names)
`{ productId (UUID, NOT productCode), category, issueSummary, whatWereYouTryingToDo, whatWentWrong, pageOrStep|null, stepsToReproduce|null, applicationReference|null, reporterName, reporterType, reporterEmail|null, reporterWhatsapp|null, deviceType:null, browser:null, canContact:true, consent:true, deviceInfo:{ua,os,viewport,language,referrerPath,hrefPath} }`

**Validation:** requires `reporterType`; requires `reporterEmail` OR `reporterWhatsapp` (at least one); requires `consent:true`; requires productId/category/issueSummary/whatWereYouTryingToDo.

## Enum gotchas (the two things that cost the most time)
- **`productId` is the UUID, not the product code.** EMA product id = `6e23325e-6d20-40ea-ade3-ced64862ed17`. Override via `SUPPORT_HUB_PRODUCT_ID` env.
- **There is NO `"other"` category.** `"other"` is a *reporterType*, not a category — sending it as category → 400. Valid categories: `technical_bug, account_login_issue, otp_verification_issue, document_upload_issue, application_flow_confusion, payment_issue, consultant_issue, partner_issue, feature_request, complaint, data_correction_request, security_privacy_concern, performance_issue, system_downtime, general_support`. Safe fallback = `general_support`.
- reporterType enum: `public_visitor, applicant, consultant, beauty_client, beauty_professional, partner, internal_tester, other`. EMA applicants → `applicant`.

## Our integration
`artifacts/api-server/src/lib/supportHub.ts` (`forwardSupportTicketToHub`) maps the 4-field Support Centre widget onto this schema, called fire-and-forget from `routes/support.ts` after the local insert. On success we persist `hub_ticket_reference`/`hub_synced_at` back on the `support_requests` row. Submissions without an email are skipped (`no_contact_email`) because the hub requires a contact.
