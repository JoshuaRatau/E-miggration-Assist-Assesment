---
name: Resend sender domain mismatch
description: Why platform email "from" address can silently bounce, and how the sender is chosen
---

# Resend sender domain

All platform email (campaigns, OTP, confirmations, notifications) sends FROM a single
canonical address resolved in `artifacts/api-server/src/lib/email.ts`:
`process.env.EMAIL_FROM?.trim() || SPEC_FROM_EMAIL` where `SPEC_FROM_EMAIL =
"noreply@emigration-assist.com"`. The Resend **connector's** `from_email` is deliberately
NOT used anymore.

**Why this matters / gotcha:** the live Resend connector was configured with
`no-reply@migration-assist.com` — note the domain is MISSING the leading "e"
(migration-assist vs emigration-assist). Sending from `emigration-assist.com`
requires THAT domain to be verified in Resend (SPF/DKIM). If only the typo'd
domain is verified, every send from the canonical address bounces.

**How to apply:** any time the "from" address or sender domain changes, confirm the
domain is verified in the Resend dashboard before relying on delivery. Override per
environment with `EMAIL_FROM` if a different verified sender is needed.

## Replit testing has no verified domain → use Resend's built-in test sender

On the Replit (dev) environment email goes through the Resend **connector** (Path 2 in
`loadResendSettings`). `emigration-assist.com` is NOT verified on that connected Resend
account, so every send from the canonical address fails with a 403 `validation_error`
("domain is not verified") and the OTP/support flows fall back to the dev code.

**Fix used:** set `EMAIL_FROM=onboarding@resend.dev` scoped to the **development**
environment only (never `shared`/`production` — production email must keep its own
verified sender). Resend's `onboarding@resend.dev` is always verified, so dev sends
succeed — BUT Resend's test mode only delivers to the **Resend account owner's own
email address**; any other recipient is rejected with a 403 telling you to verify a
domain. So OTP testing on Replit only works when you send to that owner inbox.

**Why:** production almost certainly sends via its own verified path (SMTP / verified
domain), which is why prod OTP works while Replit dev did not.

**How to apply:** to send Replit test emails to arbitrary recipients, the real
domain must be verified at resend.com/domains; the test-sender route is owner-inbox
only.
