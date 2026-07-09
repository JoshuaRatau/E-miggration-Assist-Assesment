# Services, Jobs & Integrations

For each: trigger → handling code → failure modes → importance to the funnel.

## 1. Email (Resend, optional SMTP override)

- **Trigger:** lead confirmations, OTP fallback, campaign sends, internal notifications, referral offer emails.
- **Code:** `lib/email.ts`, gateway `lib/messaging.ts`.
- **Identity:** `E-Migration Assist <noreply@emigration-assist.com>` (`EMAIL_FROM` || spec constant). **The domain must be verified in Resend (SPF/DKIM) or sends bounce.**
- `sendInternalNotificationEmail` skips the forbidden-phrase content screen so team alerts are never blocked by user-authored text.
- **Failure modes:** missing key (permanent), content screen (permanent), provider/network (transient).
- **Importance: critical** — confirmations and OTP fallback.

## 2. WhatsApp (Twilio)

- **Code:** outbound `lib/whatsappClient.ts`; inbound `lib/whatsappWebhook.ts` + `routes/whatsappWebhook.ts`.
- **OTP uses an approved Content Template** (`TWILIO_WHATSAPP_TEMPLATE_SID` — config-only, never hardcoded). Mandatory outside the 24h session window; free-form fallback is dev-only. ⚠️ A template being *handed over* as approved doesn't make it approved — verify via Twilio Content API; unapproved templates fail delivery with error 63016 even though the API returns 201.
- **Inbound webhook:** Twilio HMAC-SHA1 signature verified via the official SDK; **fails closed** (503 unconfigured, 403 invalid).
- **Importance: high** — primary channel for many leads.

## 3. OTP flow

- `lib/otp.ts` + `routes/otp.ts`: 6-digit, hashed at rest, 10-min TTL, 5 attempts, single-use. WhatsApp first, email fallback. Guards lead creation.

## 4. Background jobs (pg-boss v12 + in-process tickers)

| Job | Code | Semantics |
|---|---|---|
| `campaign-recipient-send` queue | `lib/queue.ts`, `lib/campaignSendWorker.ts` | batch 8; atomic claim `queued→sending` via `returning()` (no double-sends); unsubscribe suppression; per-recipient outcome counters; `maybeFinaliseCampaign` flips to `completed` exactly once. |
| Campaign schedule worker | `lib/campaignScheduleWorker.ts` | 30s tick, single replica; atomically claims due `scheduled` campaigns; audience re-evaluated at fire time. |
| Score worker | `lib/scoreWorker.ts` | 60s tick; recomputes dirty leads (events since last compute), batch 200. Accepted ~60s lag. |

⚠️ **Deployment constraint:** pg-boss requires a **Reserved VM** — autoscale breaks the queue.

## 5. Template rendering & audiences

- `lib/campaignRender.ts`: strict 4-token replacement, no logic — injection-safe.
- `lib/audienceQuery.ts`: zod-validated JSON rules → SQL via closed field/operator allow-list; refuses empty rule lists.

## 6. Unsubscribe

- `lib/unsubscribe.ts`: stateless HMAC-signed tokens (channel + contact), `timingSafeEqual`, RFC-8058 one-click header. POPIA compliance; fails closed in prod without a secret.

## 7. Document upload

- `lib/objectStorage.ts` / `lib/objectAcl.ts`: Replit Object Storage (GCS) by default, AWS S3 in production (`STORAGE_PROVIDER=s3` — the AWS credentials in this repo are S3-only). 15-minute presigned PUT URLs; files stored as `uploads/<uuid>`; server-side type allow-list; session-scoped listing.

## 8. Referral tunnel (SENDER side — never build the receiver here)

- **Code:** `lib/referralTunnel.ts` (HMAC + serializations), `lib/emaFirmDirectory.ts` (match API client), `routes/referrals.ts` (consent/preview/gate/callback).
- **Flow:** POPIA consent → signed non-PII match request to `POST {EMA_APP_URL}/api/referrals/match` → store `ema_firm_id` only → fire-and-forget redacted offer email to the firm admin (recipient = `firmContactEmail` from the match response, else signed contact lookup) containing EMA's signed `acceptUrl` → EMA converts via terminal, idempotent signed callback.
- **Live contract notes (July 2026):** EMA's live response uses `firmDisplayName` + a structured `preview` object (with nullable fields) — the parser deliberately accepts BOTH the documented and live shapes; keep it dual-shape. Full contract in `docs/recommended-fix-or-clarification.md`.
- **What breaks it:** secret mismatch (silently degrades to honest-unmatched), `EMA_APP_URL` misconfiguration, EMA-side contact endpoint absence (offer email skipped + audited).
- **Importance: high** — the revenue hand-off.

## 9. Billing mirror (inbound from main EMA)

- `POST /api/webhooks/emigration-billing` (HMAC-verified) writes `billing_*` tables; `billing_unmatched` is the reconciliation queue. Read-only mirror — the funnel never originates billing data.

## 10. Support hub mirror

- `lib/supportHub.ts` + `routes/support.ts`: widget submissions forwarded fire-and-forget to the external Eride Support Hub (product code `EMA`); returned reference persisted locally; falls back to internal email if the hub is unreachable. Importance: medium.

## 11. Meta Pixel (frontend only)

- `src/lib/metaPixel.ts`: PageView / ViewContent / Lead / SubmitApplication / Contact only (payment/subscribe/schedule/registration deliberately excluded). Base ID hardcoded in `index.html`. `sessionStorage` guard prevents double-fires. No PII sent. Importance: marketing attribution only.
