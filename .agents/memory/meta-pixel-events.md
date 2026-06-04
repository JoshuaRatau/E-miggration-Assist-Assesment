---
name: Meta Pixel standard events
description: Which Meta Pixel standard events this app fires (and which were deliberately excluded) plus how the integration is wired.
---

# Meta Pixel integration

Base pixel snippet is **hardcoded in `index.html`** (fires the initial `PageView`). It was deliberately NOT converted to a `VITE_META_PIXEL_ID` env var — the user said "don't change anything else"; the env-var option was offered to the user as a future improvement.

All app-level events go through `src/lib/metaPixel.ts`:
- `trackPixel(event, params?)` — no-throw, no-op if `window.fbq` is missing/blocked.
- `trackPixelOncePersistent(key, event, params?)` — sessionStorage dedupe by key.
- The `event` type is a closed union — only the allowed events compile.

**Events fired (only these — the union enforces it):**
- `PageView` — base snippet on first load; `PixelPageTracker` (App.tsx) on subsequent SPA navigations.
- `ViewContent` — key public pages (home, pricing, assessment, overstay) via `CONTENT_PAGES` map in App.tsx.
- `Lead` — assessment finalize, gated on `res.ok` (fetch resolves on 4xx/5xx too).
- `SubmitApplication` — thank-you page, only once the reference resolves to a real lead, deduped per reference.
- `Contact` — support widget on successful submit.

**Why these are excluded (no matching app functionality):** Purchase / InitiateCheckout / AddPaymentInfo / Subscribe (no payments — Paystack unimplemented), Schedule (no booking), CompleteRegistration (only admin login, not public), AddToCart etc.

**No PII is ever sent** — only descriptive `content_name` / `content_category`.

**Dedup gotcha:** `PixelPageTracker` page-view dedup uses a **module-scoped** `lastTrackedPixelPath`, not a component `useRef`, so it survives React StrictMode unmount/remount in dev.
