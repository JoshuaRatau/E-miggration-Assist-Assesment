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

1. **Server-side match by EMA** — on POPIA consent the funnel sends a signed,
   NON-PII match request to `POST {EMA_APP_URL}/api/referrals/match` (5s
   timeout). EMA decides the firm using its own knowledge of active, vetted
   firms, regions, specialties, and capacity. The funnel performs NO local
   matching and stores NO firm data.
2. **Storage** — only the matched firm's EMA id is stored, in the existing
   `referrals.ema_firm_id` (text); the legacy `funnel_firm_id` stays NULL.
   Firm name / match tier land in the append-only `referral_audit` detail.
3. **No match / EMA unavailable** — the referral is created UNMATCHED, audited
   as `no_available_firm_match` / `ema_unavailable`; no preview email is sent
   and no internal firm data is exposed to the applicant.
4. **Firm offer notification** — a redacted-preview email (firm display name,
   redacted preview, signed accept URL, NO applicant PII) goes to the firm's
   admin email. The address comes from the match response
   (`firmContactEmail`) when EMA provides it, else via the signed contact
   lookup below. A miss is audited as
   `failed / offer_email / ema_firm_contact_unavailable`.
5. **Referral tunnel payloads** — the redirect token and the signed applicant
   push body carry an additive optional `emaFirmId` field so EMA can route the
   accepted referral to the right firm. Existing fields are unchanged.

## REQUIRED on the EMA platform side

### New endpoint: firm matching (PRIMARY)

```
POST /api/referrals/match
Headers:
  content-type: application/json
  x-referral-signature: <base64url HMAC-SHA256 (unpadded), NOT hex>
Body (non-PII; keys present only when a value exists):
  {
    "leadReference": "EMA-XXXXXXXX-XXXX",
    "matterType": "Visa application",
    "region": "Gauteng",
    "urgency": "urgent",
    "route": "overstay",          // optional (funnel route)
    "theme": "dark"               // optional (funnel theme)
  }
```

- Signature: `HMAC_SHA256(REFERRAL_TUNNEL_SECRET, stableStringify(body))` —
  key-sorted JSON serialization, identical to the applicant-push convention.
- EMA must verify the signature and respond **200** with:

```
{
  "matched": true,
  "firmId": "<EMA firm uuid>",
  "firmDisplayName": "IOS Immigration Consultants",       // live shape ("firmName" also accepted)
  "preview": {                                            // live shape; a "redactedPreview" string also accepted
    "displayName": "IOS Immigration Consultants",
    "region": "Gauteng",
    "specialties": "Critical Skills,General Work",
    "verified": true
  },
  "matchTier": "specialty_region",                        // optional
  "acceptUrl": "https://<ema>/api/referrals/match/accept?token=...", // REQUIRED on matched:true, signed + expiring
  "acceptToken": "...",                                   // optional (funnel ignores; uses acceptUrl verbatim)
  "expiresAt": 1783849382463,                             // optional
  "firmContactEmail": "admin@firm.example"                // optional — if absent the funnel uses the fallback contact lookup below
}
```

> The funnel accepts BOTH the documented shape (`firmName` + `redactedPreview`
> string) and the live-observed shape (`firmDisplayName` + `preview` object).
> A `matched:true` response WITHOUT `acceptUrl` is treated as unavailable and
> no offer email is sent.

- No available firm → **200** `{ "matched": false }` (NOT a 404 — the funnel
  treats non-2xx as "EMA unavailable").
- `acceptUrl` must be a signed, expiring URL minted by EMA; the funnel embeds
  it verbatim in the firm offer email.

### Fallback endpoint: firm admin contact lookup

```
GET /api/referral-tunnel/firms/:firmId/contact
Headers:
  x-funnel-timestamp: <epoch ms>
  x-funnel-signature: <base64url HMAC-SHA256 (unpadded), NOT hex>
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
