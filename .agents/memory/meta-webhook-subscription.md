---
name: Meta leadgen webhook subscription
description: How instant lead delivery is wired and why it can't be activated from dev.
---

# Meta leadgen webhook subscription

Two subscriptions are needed for instant lead delivery, both automated (no Meta dashboard steps):
1. **App-level** — `POST /{app-id}/subscriptions` (app token `id|secret`) registering callback URL + verify token + `leadgen`. Done via admin `POST /api/meta/webhook/subscribe`.
2. **Page-level** — `POST /{page-id}/subscribed_apps` with `subscribed_fields=leadgen` (page token). Runs automatically inside `completeConnection` during OAuth, and is re-runnable via the same admin endpoint (which also reads back `subscribed_fields` to confirm).

**Gotcha:** Meta synchronously GET-verifies the callback URL when the app-level subscription is created. The callback must be the DEPLOYED host (`META_WEBHOOK_CALLBACK_URL`, set to `https://immigrationassist.replit.app/api/meta/webhook`) and production must run code that has the webhook route — a stale deployment 404s and Meta rejects with `(#2200) Callback verification failed`. So activation always requires a republish first; it cannot be completed from the dev workspace.

**How to apply:** after any republish, hit `POST /api/meta/webhook/subscribe` (admin) once and check `leadgenActive: true` in the response. Env: `META_WEBHOOK_VERIFY_TOKEN` + `META_WEBHOOK_CALLBACK_URL` are shared env vars (apply to dev and prod).
