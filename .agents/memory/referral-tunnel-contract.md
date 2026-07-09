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

## Route-aware push metadata (funnel↔EMA vocabulary — lockstep)
- The applicant-push body carries OPTIONAL route-aware metadata: `route`, `theme`, `funnelContext`, `referenceNumber`, `leadId`, `leadReference`, `funnelVersion`. All are additive and assigned CONDITIONALLY (key omitted when unavailable — never `undefined`, which breaks `stableStringify`/HMAC). Legacy bodies (no funnel context) keep the old shape.
- **Route vocabularies differ:** funnel funnel-context routes = `traveller | overstay_undesirable | firm_professional | continue_reference`; EMA's = `traveller | overstay_undesirable | firm_professional | reference_resume`. `toEmaReferralRoute()` (in `referralTunnel.ts`) maps `continue_reference → reference_resume` (identity for the 3 shared) and returns `null` for anything unrecognised so an invalid route is NEVER sent. **Why:** EMA lists `reference_resume` (a value the funnel never natively stores) — the mismatch is the signal a mapping is intended, not a strict pass-through. Change funnel↔EMA route vocab in lockstep.
- `leadReference` = `lead.referenceNumber` (funnel has ONE reference per lead; sent under both keys). `funnelVersion` = constant `FUNNEL_PAYLOAD_VERSION` (`"1"`) — a contract stamp; bump in lockstep with EMA when the metadata shape changes.
- Adding a route value ⇒ update the funnel `ALLOWED_ROUTES` (funnelContext.ts) AND the EMA set/alias in `referralTunnel.ts`.

## Firm matching (EMA is the sole matcher)
- The funnel does NO local firm matching and stores NO firm data. On POPIA consent it POSTs a signed NON-PII request to `{EMA_APP_URL}/api/referrals/match` (`x-referral-signature` = base64url HMAC over `stableStringify(body)`, NOT hex).
- Body: `leadReference, matterType, region, urgency` + optional `route/theme` (keys omitted when absent — never undefined/null in the signed body).
- A `matched:true` response MUST carry `firmId + firm name + acceptUrl` or the funnel treats it as unavailable — the offer email must never go out without EMA's signed accept URL (no funnel-minted fallback link).
- LIVE EMA response shape drifts from the doc: `firmDisplayName` (not `firmName`) + structured `preview` object (not `redactedPreview` string). The funnel parser accepts BOTH shapes; keep it dual-shape — don't "clean it up" to one.
- Verified live 2026-07-09: signed match returns 200 matched:true end-to-end once secrets are byte-identical. EMA sends no `firmContactEmail` and its fallback contact endpoint doesn't exist yet ⇒ offer email is skipped and honestly audited (`ema_firm_contact_unavailable`) — that's the expected state until EMA ships the contact endpoint.
- No match / EMA down ⇒ referral created UNMATCHED (`ema_firm_id` null), audited `no_available_firm_match` / `ema_unavailable`, NO email (user-confirmed fail-closed). Only `referrals.ema_firm_id` is persisted; firm name/tier go to audit detail; `acceptUrl` is never persisted.
- Offer email recipient = `firmContactEmail` from the match response, else signed fallback `GET /api/referral-tunnel/firms/:firmId/contact`. Full EMA-side contract in `docs/recommended-fix-or-clarification.md`.

## Config
- `EMA_APP_URL` = base URL of the main EMA app (redirect target). Dev uses a janeway `.replit.dev` URL (dev-scoped env); live needs the PUBLISHED EMA URL. `EMA_APP_URL` is not sensitive (plain env var ok); `REFERRAL_TUNNEL_SECRET` is sensitive (Replit Secret, identical on both sides).
