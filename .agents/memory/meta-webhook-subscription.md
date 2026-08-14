---
name: Meta leadgen webhook subscription
description: Durable constraint — webhook activation requires a deployed (published) backend, not dev.
---

# Meta leadgen webhook subscription

**Durable constraint:** Meta synchronously GET-verifies the callback URL when the app-level subscription is created. Activation always requires a republish first — it cannot be completed from the dev workspace. A stale or missing deployment causes Meta to reject with `(#2200) Callback verification failed`.

**Why:** The callback URL is `META_WEBHOOK_CALLBACK_URL` (production host), and production must be running code that has the `/api/meta/webhook` route registered. Dev workspace URLs do not satisfy this.

**How to apply:** after any republish, hit `POST /api/meta/webhook/subscribe` (admin endpoint) once and verify `leadgenActive: true` in the response.
