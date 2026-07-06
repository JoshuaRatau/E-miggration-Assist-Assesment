---
name: Funnel route context storage
description: Where funnel route/theme context is stored and the three lead-creating paths that must stay in sync
---

# Funnel route context (route / theme)

Landing-page CTAs tag each route with URL query params (`route`, optional `theme`);
they are captured at submission and persisted to `prelaunch_leads.funnel_context`
(nullable `jsonb`, shape `{route?, theme?}`). Pure attribution metadata — never
drives questionnaire logic, scoring, validation, or dispatch.

**There are THREE lead-creating paths, all inserting into `prelaunch_leads`.**
Any future attribution/context field must be wired into all three or coverage is
partial:
- `POST /api/leads` (individual assessment — traveller / stuck-application)
- `POST /api/overstay-intake` (overstay funnel)
- `POST /api/business-intake` (firm/professional funnel)
The two intake routes already stash their rich answers as JSON in `admin_notes`.

**Why a dedicated jsonb column, not `sourceCampaign`:** `source` is a locked enum
(off-list values coerce to `"other"`), and `sourceCampaign` is single-value and
already owned by campaign attribution (feeds the Phase 6E source dashboard).
Two structured values (route+theme) had no clean existing home, so the user
approved a dedicated column.

**Validation-untouched trick:** `POST /api/leads` reads `funnelContext` straight
off `req.body` (like `finalize` / `verifiedOtpId`), NOT via the generated
`CreateLeadBody` zod schema — so adding submission context never changes the
questionnaire validation contract or requires OpenAPI/codegen churn.

**Allow-listing:** server-side `sanitizeFunnelContext` (api-server `lib/funnelContext.ts`)
keeps only known route/theme values, drops unknown, returns `null` when empty —
so a tampered query string can't pollute the column. Frontend mirror helper reads
the params from `window.location.search`.

**Prod note:** the `funnel_context` column must exist in the production DB before
deploy (`pnpm --filter @workspace/db run push`) or writes fail. Note the db push
script lives in the `@workspace/db` package, not the repo root.
