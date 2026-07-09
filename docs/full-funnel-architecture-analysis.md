# EMA Leads Funnel — Full Architecture Analysis

> Audience: operator/founder first, engineers second. Everything here is traced from the actual code (July 2026). Where something is inferred rather than directly confirmed, it is flagged.

## 1. What this system is

This repository is **NOT the main E-Migration Assist platform**. It is the **lead-capture funnel + admin CRM** that feeds it. It does four jobs:

1. **Capture** — public assessment funnels (general visa, overstay, business/firm) that turn visitors into verified leads.
2. **Qualify & work** — an admin CRM (pipeline, scoring, notes, ownership, follow-ups) that turns leads into workable records.
3. **Reach out** — a campaign engine (email + WhatsApp) with templates, audiences, scheduling and a background queue.
4. **Hand off** — lead→case conversion, client-portal preparation, and a signed, PII-safe **referral tunnel** into the main EMA platform.

## 2. Repository layout (pnpm monorepo)

```
artifacts/
  api-server/          Express 5 backend — all API routes, workers, queue
  emigration-assist/   React + Vite SPA — public funnel + admin CRM
  mockup-sandbox/      Dev-only UI component preview (ignore for business)
lib/
  api-spec/            OpenAPI 3.0 source of truth (openapi.yaml) + Orval codegen
  api-client-react/    GENERATED TanStack Query hooks (do not hand-edit)
  api-zod/             GENERATED Zod validation schemas (do not hand-edit)
  db/                  Drizzle ORM schema (src/schema/, one file per domain) + client
docs/                  Architecture, functional spec, this analysis set
scripts/               Utility scripts (post-merge.sh etc.)
tests/e2e/             Playwright E2E suites, scopes A–H
```

Key configs: `pnpm-workspace.yaml` (workspace + version catalog), `vercel.json` (frontend deploy), `lib/db/drizzle.config.ts`, `artifacts/api-server/build.mjs` (esbuild bundle), `tsconfig.base.json`.

**Dependency flow:** `openapi.yaml` → (Orval codegen) → `api-zod` + `api-client-react` → consumed by server (validation) and SPA (hooks). Server depends on `@workspace/db`; SPA depends on `@workspace/api-client-react`.

## 3. Frontend architecture

- **React + Vite SPA** (`artifacts/emigration-assist`), routing via **Wouter**.
- Vite `base` defaults to `/assessment/` (production is served under that path on the marketing site); `BASE_PATH` env overrides in Replit dev.
- API resolution: every call uses `${VITE_API_URL ?? BASE_URL}/api/...`. On Vercel `VITE_API_URL=https://immigrationassist.replit.app`; on Replit dev it's same-origin.
- Data fetching: generated React Query hooks for OpenAPI routes; direct `fetch()` with `credentials: "include"` for bespoke admin routes.
- Admin shell: single `admin-layout.tsx`; `AdminUserMenu` is the sole navigation surface (no left sidebar).
- Theme: globally dark; some public cards use scoped light CSS-var overrides.

## 4. Backend architecture

- **Express 5** (`artifacts/api-server`), Node 24, bundled by esbuild, structured logging via pino (`req.log`).
- Routes in `src/routes/`, shared logic in `src/lib/`.
- Mounted under `/api`. Validation with Zod (generated schemas where in OpenAPI, bespoke inline elsewhere).
- **Deliberate OpenAPI split:** stable public/admin read routes are in OpenAPI; most admin mutations, stats, and the referral tunnel are **bespoke** (kept out to avoid codegen churn and because the `x-admin-token` header doesn't flow through the generated client).
- Boot-time bootstraps: demo admin seed, ~20 seed comm templates, disabled lifecycle rules.

## 5. Database architecture

- PostgreSQL + Drizzle. Schema split by domain under `lib/db/src/schema/`: `leads`, `leadCases`, `admin`, `imports`, `campaigns`, `templates`, `lifecycle`, `referrals`, `support`, `billing`.
- Deliberate patterns: **soft references without FKs** (e.g. `assigned_to` → admin_users), **text status columns** (no enum migrations), **append-only audit/event tables**, `ON CONFLICT` idempotency guards.
- See `database-domain-map.md` for the full table-by-table map.

## 6. Background jobs

All in-process, started from `artifacts/api-server/src/index.ts`:

| Worker | File | Cadence | Job |
|---|---|---|---|
| pg-boss queue `campaign-recipient-send` | `lib/queue.ts` + `lib/campaignSendWorker.ts` | event-driven, batch 8 | per-recipient campaign sends, atomic claim, single-winner finaliser |
| Campaign schedule worker | `lib/campaignScheduleWorker.ts` | every 30s | claims due `scheduled` campaigns and enqueues |
| Score worker | `lib/scoreWorker.ts` | every 60s | recomputes lead scores from the `lead_events` stream (batch 200) |

⚠️ **pg-boss requires a Reserved VM deployment** — autoscale breaks the queue.

## 7. Deployment topology (live)

```
Browser → www.emigration-assist.com/assessment/*   (marketing site, separate Vercel project)
              │  rewrite (path-stripped)
              ▼
          <assessment>.vercel.app/*                (this repo's Vite SPA build)
              │  fetch with credentials
              ▼
          immigrationassist.replit.app/api/*       (this repo's Express + pg-boss + Postgres)
```

- Repo auto-pushes to GitHub `main`; Vercel auto-deploys on push. Backend publishes via Replit Publish.
- **Cross-origin:** API honours a `WEB_ORIGIN` allow-list; admin cookie flips to `SameSite=None; Secure` when `CROSS_SITE_COOKIES=true`. **Fail-closed:** production refuses to boot if `CROSS_SITE_COOKIES=true` without `WEB_ORIGIN`.
- **Environment separation:** dev (Replit workspace, same-origin, dev DB) vs production (split Vercel/Replit, prod DB). Dev-only bypasses (`E2E_DISABLE_RATE_LIMIT`, `DISABLE_OTP_VERIFICATION`) are refused when `NODE_ENV=production`.
- ⚠️ Known operational gotcha: if the live frontend's `VITE_API_URL` ever points at a stale backend (a separate `api.emigration-assist.com` existed historically), "works on replit.app but broken live" = wrong backend, not code.

## 8. Auth model

- **Public users have NO login.** Access is by reference number (`/status` lookup) and OTP verification at intake.
- **Admins**: email+password → opaque server-side session in httpOnly `ema_admin_session` cookie (7-day TTL); legacy `x-admin-token` header still honoured as fallback. Superadmin-only user management with self-protection. Forgot-password mints a 1-hour single-use hashed token.

## 9. Integration boundary with the main EMA platform

This repo is the **SENDER** side only. Touchpoints:

1. **Referral tunnel** (`lib/referralTunnel.ts`, `lib/emaFirmDirectory.ts`, `routes/referrals.ts`): consent-gated, HMAC-signed. EMA is the *sole* source of firm matching (`POST {EMA_APP_URL}/api/referrals/match`); the funnel stores only `ema_firm_id`, never firm PII or applicant PII in referral tables. Fail-closed (503 without secret).
2. **Billing webhook** (`POST /api/webhooks/emigration-billing`): EMA pushes revenue events; the funnel mirrors them into `billing_*` tables (read-only mirror + reconciliation queue).
3. **Support hub mirror**: support-widget submissions forwarded fire-and-forget to the external Eride Support Hub.

**Risky couplings, precisely:** (a) the match-response shape drifted from the documented contract once already (parser now accepts both shapes — keep it dual-shape); (b) `REFERRAL_TUNNEL_SECRET` and `EMA_APP_URL` must be byte-identical/valid on both sides or matching silently degrades to honest-unmatched; (c) EMA's firm-contact endpoint is not yet implemented — offer emails depend on `firmContactEmail` in the match response.

## 10. Known mismatches & housekeeping (flagged, not fixed)

- `_twilio_oneshot_test.mjs` / `twilio_inbound_test.mjs` in api-server: ad-hoc scripts, not part of the app.
- `attached_assets/` holds brief/build images unused at runtime.
- GitHub repo name is typo'd (`E-miggration-Assist-Assesment`) but stable — do not rename.
- The lifecycle automation module is a **read-only scaffold** (rules seeded disabled, no worker) — deliberate, not dead code.
