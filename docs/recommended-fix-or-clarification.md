# Recommended Fix / Clarification — Funnel ↔ Main EMA Platform

Companion to: `funnel-main-app-miscommunication-analysis.md`, `funnel-dependency-map.md`,
`funnel-only-test-findings.md`, `funnel-integration-boundary-findings.md`.

## Verdict recap

The funnel is correctly isolated. The one real gap was firm matching: the funnel
previously matched against its own local `partner_firms` table, while the real
partner firms live in the main EMA platform. That gap is now **fixed on the funnel
side** — matching is a live lookup against EMA (single source of truth; if EMA is
unreachable the referral is created UNMATCHED, never matched against stale data).

## What the funnel now does (implemented)

1. **Live directory fetch** — `GET {EMA_APP_URL}/api/public/firms` (5s timeout,
   verified firms only). On failure → referral created unmatched, audit
   `firmDirectory: "unavailable"`.
2. **In-memory match** — specialty+region → region → specialty → any verified firm
   ("South Africa" region matches all). Matched firm's EMA id is stored in
   `referrals.ema_firm_id` (text); the legacy `funnel_firm_id` stays NULL.
3. **Firm offer notification** — the funnel needs the firm's admin email (set at
   EMA registration). It calls a **signed EMA endpoint that does not exist yet**
   (see contract below). Until EMA ships it, the miss is audited as
   `failed / offer_email / ema_firm_contact_unavailable` and the flow continues.
4. **Referral tunnel payloads** — the redirect token and the signed applicant push
   body now carry an additive optional `emaFirmId` field so EMA can route the
   accepted referral to the right firm. Existing fields are unchanged.

## REQUIRED on the EMA platform side

### New endpoint: firm admin contact lookup

```
GET /api/referral-tunnel/firms/:firmId/contact
Headers:
  x-funnel-timestamp: <epoch ms>
  x-funnel-signature: <hex HMAC-SHA256>
```

- Signature: `HMAC_SHA256(REFERRAL_TUNNEL_SECRET, stableStringify({ firmId, timestamp }))`
  — key-sorted JSON serialization, same `signBody` convention as the existing
  server-to-server push (§3.2 of the tunnel contract). Shared secret:
  `REFERRAL_TUNNEL_SECRET` (already shared by both sides).
- EMA must: verify the signature, reject timestamps older than ~5 minutes
  (replay protection), and respond `200 { "adminEmail": "<firm admin email>" }`
  or `404` if the firm is unknown.
- PII note: this returns the FIRM's business contact email only — no applicant PII.

### Accept the additive `emaFirmId`

- Redirect-token payload (§3.1) and applicant push body (§3.2) may now include an
  optional `emaFirmId` string (EMA's own firm UUID). Receivers must tolerate and
  ideally use it to attach the referral to that firm. All other fields unchanged;
  HMAC covers the whole body as before.

## Configuration clarification needed

`EMA_APP_URL` currently points at an EMA instance whose firm directory does NOT
match `https://data-migration-assist-backup.replit.app` (the confirmed dev EMA).
The matched firm id returned in testing was not present in the backup app's
directory. → Update the `EMA_APP_URL` secret to the backup URL for dev, and to the
production EMA backend URL at go-live.

## Explicit non-goals (funnel side)

- No firm data is cached or mirrored locally; the local `partner_firms` admin UI
  is legacy and no longer feeds matching.
- If EMA is down: no match, no fallback — by design (user-confirmed).
