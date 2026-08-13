---
name: Meta Analytics module
description: How the Facebook/Instagram analytics integration is architected and its non-obvious constraints.
---

# Meta Analytics module

- Dashboard (`/admin/meta-analytics`) reads ONLY cached DB data; syncs pull from the Meta Graph API (manual button, 45-min in-process ticker, leadgen webhook). No mock data ever — missing metrics render "Metric unavailable through Meta API".
- Tokens: AES-256-GCM encrypted at rest, key derived from `SESSION_SECRET` (`:meta-token-v1` suffix). Rotating SESSION_SECRET invalidates stored Meta tokens → users must reconnect.
- OAuth state is stateless HMAC (also SESSION_SECRET-derived), 15-min TTL. Redirect URI must exactly match what's registered in the Meta app; `GET /api/meta/status` reports the current one.
- **Why partial sync:** each sync section (FB insights, IG insights, audience, campaigns, forms/leads, content) fails independently — missing permissions on one surface must not block the rest. EXCEPT `token_expired`, which aborts and flips the connection to the reconnect state (never advance lastSyncedAt on auth failure).
- Meta lead → CRM import uses a pg advisory xact lock on the contact identity (email/phone) to make webhook+sync races safe; dedupe rule mirrors the intake routes (lower(email) OR whatsapp).
- Campaign/ad numbers are Meta-reported LIFETIME aggregates; keep them labelled separately from CRM conversion counts — never mix.
- Config: `META_APP_ID`, `META_APP_SECRET` (also signs webhooks), `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` (default v23.0). Setup guide: `docs/meta-integration.md`.
- Gotcha: after adding schema files to `lib/db`, run `pnpm exec tsc -b` in lib/db — api-server resolves types via project-reference dist d.ts, not src.
