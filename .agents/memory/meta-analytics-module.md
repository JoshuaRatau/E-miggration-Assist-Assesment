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

## Sync classification contract (metaSyncClassify.ts)

Pure helpers live in `src/services/meta/metaSyncClassify.ts`, unit-tested independently (18 tests in `metaSyncClassify.test.ts`).

**SectionResult prefixes and their meaning:**

| Prefix | isProgressResult | isGenuineFailure | Meaning |
|--------|-----------------|-----------------|---------|
| `ok` | ✅ | ❌ | Section wrote rows, no errors |
| `partial: …` | ✅ | ✅ | Some rows written, some metrics/sources failed |
| `empty: …` | ❌ | ❌ | API succeeded but 0 rows written (new page, no activity) |
| `no …` | ❌ | ❌ | Source not configured (no page/account connected) |
| `permission_missing: …` | ❌ | ✅ | All metrics denied by Meta permissions |
| `api_error: …` | ❌ | ✅ | Operational failure (rate_limited, network, etc.) |
| `token_expired…` | ❌ | ❌ | Auth broken — handled by its own branch, not in syncWarnings |
| `fb:api_error: …` etc. | ❌ | ✅ | Sub-prefixed content section error |

**Key invariants:**
- `synced++` / `writes++` only increments when actual DB rows are written — an empty API response (new page, no posts/insights data) is NOT counted as progress.
- `syncContent` returns `partial: N items synced; <error>` when `totalWrites > 0` but a source failed — so `isProgressResult` correctly sees it as progress.
- `runOk = anyProgress && !syncWarnings` — partial runs (progress + failures) return `ok: false` so the mutation fires the warning toast, not the success toast.
- `completeConnection` sets `status: "unverified"` (not "active") — advances to "active" only when the first sync has `anyProgress=true`. Scheduled worker retries "unverified" alongside "active".
- `lastSyncedAt` only advances when `anyProgress=true` — preserves the 90-day backfill window until real data lands.

## Page selection
OAuth auto-picks the FIRST page from me/accounts — wrong for multi-page users. Admin UI has a Page switcher (GET /api/meta/pages, POST /api/meta/select-page). Switching purges ALL cached meta_* analytics tables (not imported CRM leads), resets lastSyncedAt, unsubscribes old page webhook, resubscribes new one, and is blocked (409) while a sync is running — a mid-sync switch would write old-page data against the new selection.
