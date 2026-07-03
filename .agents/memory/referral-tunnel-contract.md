---
name: EMA referral tunnel (sender side)
description: Durable rules for the funnel→EMA referral tunnel — HMAC contract, PII boundary, fail-closed, terminal states.
---

# EMA referral tunnel — sender-side contract

This repo (EMA Leads Funnel) is the SENDER. The receiver is the SEPARATE main
E-Migration Assist platform — never build the receiving side here.

## Two serializations on purpose (do NOT unify)
- **Redirect token body** = `base64url(JSON.stringify(payload))`; signature = HMAC over that base64url STRING. Token wire form is `"<body>.<sig>"`.
- **Server-to-server body** = HMAC over `stableStringify(body)` (recursive key-sort, no `undefined` — use `null`).
**Why:** both systems must produce byte-identical input to HMAC. Any drift in either serialization makes every signature fail. Change the funnel and EMA in lockstep or not at all.

## Fail-closed everywhere
- No `REFERRAL_TUNNEL_SECRET` ⇒ redirect AND callback return `503 tunnel_not_configured` (the callback guard runs BEFORE signature verification — a missing secret is 503, a wrong signature is 401).
- `isTunnelConfigured()` = secret AND `EMA_APP_URL` both set.

## PII boundary (hard invariant)
- The `referrals` table stores ONLY redacted fields: `matter_type`, `urgency`, `region`, `summary` + consent metadata + EMA linkage ids. It has NO name/email/phone columns by design — that is the structural guarantee.
- Applicant PII travels ONLY inside the signed applicant-push body (`buildApplicantPushBody`). Preview endpoint, audit rows, and the firm offer email must never carry PII.
- Firm offer email sign-off uses the PUBLIC brand "E-Migration Assist" (consumer-facing), not the internal "EMA Leads Funnel".

## State machine
- `converted` is terminal/immutable. Callback no-ops (200 `already_converted`) if already converted, and the UPDATE is guarded `WHERE status != 'converted'` to close the TOCTOU window against concurrent callbacks.
- Consent creation is serialized by locking the lead row `FOR UPDATE` inside a transaction and re-checking for an existing referral under the lock — prevents duplicate referrals per lead. Audit writes + firm offer email happen AFTER commit.

## Config
- `EMA_APP_URL` = base URL of the main EMA app (redirect target). Dev uses a janeway `.replit.dev` URL (dev-scoped env); live needs the PUBLISHED EMA URL. `EMA_APP_URL` is not sensitive (plain env var ok); `REFERRAL_TUNNEL_SECRET` is sensitive (Replit Secret, identical on both sides).
