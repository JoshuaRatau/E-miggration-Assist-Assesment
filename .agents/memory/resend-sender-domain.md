---
name: Resend sender domain mismatch
description: Why platform email "from" address can silently bounce, and how the sender is chosen
---

# Resend sender domain

All platform email (campaigns, OTP, confirmations, notifications) sends FROM a single
canonical address resolved in `artifacts/api-server/src/lib/email.ts`:
`process.env.EMAIL_FROM?.trim() || SPEC_FROM_EMAIL` where `SPEC_FROM_EMAIL =
"info@emigration-assist.com"`. The Resend **connector's** `from_email` is deliberately
NOT used anymore.

**Why this matters / gotcha:** the live Resend connector was configured with
`no-reply@migration-assist.com` — note the domain is MISSING the leading "e"
(migration-assist vs emigration-assist). Sending from `emigration-assist.com`
requires THAT domain to be verified in Resend (SPF/DKIM). If only the typo'd
domain is verified, every send from the canonical address bounces.

**How to apply:** any time the "from" address or sender domain changes, confirm the
domain is verified in the Resend dashboard before relying on delivery. Override per
environment with `EMAIL_FROM` if a different verified sender is needed.
