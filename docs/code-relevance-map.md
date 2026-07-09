# Code Relevance Map

A "which code matters" view for a founder/product owner. Paths relative to repo root.

## Mission-critical — core funnel behavior (break these, break the business)

| File(s) | Why |
|---|---|
| `artifacts/api-server/src/routes/leads.ts` + `routes/publicStatus.ts` | Lead intake, finalize, public lookups — the front door. |
| `artifacts/api-server/src/routes/otp.ts` + `src/lib/otp.ts` | Contact verification gate. |
| `artifacts/api-server/src/lib/confirmation.ts` | At-most-once confirmation dispatch. |
| `artifacts/api-server/src/lib/email.ts`, `src/lib/whatsappClient.ts`, `src/lib/messaging.ts` | All outbound messaging. |
| `artifacts/api-server/src/lib/rateLimit.ts` | Abuse protection on public routes. |
| `artifacts/emigration-assist/src/pages/assessment.tsx`, `overstay-assessment.tsx`, `business-assessment.tsx`, `home.tsx`, `thank-you.tsx`, `status.tsx` | Every public conversion surface. |
| `lib/db/src/schema/leads.ts` | The lead data model itself. |
| `artifacts/api-server/src/app.ts`, `src/index.ts` | Boot, CORS/cookie fail-closed checks, worker startup. |

## Admin CRM only

- `routes/adminLeads.ts`, `routes/adminAuth.ts`, `routes/adminUsers.ts`, `routes/stats.ts`, `routes/adminImports.ts`
- `lib/adminSession.ts`, `lib/audit.ts`, `lib/classification.ts` (status rules), `lib/scoringRubrics.ts`, `lib/scoreWorker.ts`
- SPA: `pages/admin*.tsx`, `components/` dashboard/kanban/drawer/timeline components, `admin-layout.tsx`
- Schema: `admin.ts`, `imports.ts`

## Outreach / campaigns only

- `routes/adminCampaigns.ts`, `routes/adminTemplates.ts`, `routes/unsubscribe.ts`
- `lib/campaignSendWorker.ts`, `lib/campaignScheduleWorker.ts`, `lib/campaignRender.ts`, `lib/audienceQuery.ts`, `lib/unsubscribe.ts`, `lib/queue.ts`, `lib/templateBootstrap.ts`
- SPA: `admin-communications.tsx`, `admin-campaign-editor.tsx`, rich editor components
- Schema: `campaigns.ts`, `templates.ts`

## Conversion / referral / EMA boundary only

- `lib/cases.ts`, `lib/caseStatus.ts`, `lib/clientPortal.ts` (conversion + portal)
- `lib/referralTunnel.ts`, `lib/emaFirmDirectory.ts`, `routes/referrals.ts` (tunnel — the HMAC contract lives here; change with extreme care)
- `routes/billingWebhook.ts` + schema `billing.ts` (revenue mirror)
- Schema: `leadCases.ts`, `referrals.ts`

## Configuration / scaffolding

- `pnpm-workspace.yaml`, `vercel.json`, `tsconfig*`, `build.mjs`, `drizzle.config.ts`, `lib/api-spec/openapi.yaml` + Orval configs
- `lib/api-client-react/`, `lib/api-zod/` — **GENERATED, never hand-edit**
- Bootstraps: `adminBootstrap.ts`, `templateBootstrap.ts`, `lifecycleBootstrap.ts`

## Safe to ignore for business understanding

- `artifacts/mockup-sandbox/` (dev preview tool)
- `attached_assets/` (brief/build files)
- `_twilio_oneshot_test.mjs`, `twilio_inbound_test.mjs` (dead ad-hoc scripts)
- shadcn UI primitives in `src/components/ui/`
- `routes/adminLifecycle.ts` + `lifecycle.ts` schema (dormant scaffold), `adminEmail.ts` legacy update route; `partner_firms` still has live admin CRUD but is no longer the referral-matching source

## Founder reading order

1. `docs/executive-understanding-of-the-funnel.md` (this analysis set)
2. `replit.md` — milestone history and durable rules
3. `routes/leads.ts` + `pages/assessment.tsx` — the money path
4. `lib/classification.ts` + `routes/adminLeads.ts` — the pipeline rules
5. `lib/referralTunnel.ts` + `routes/referrals.ts` — the EMA hand-off
6. `lib/campaignSendWorker.ts` — how outreach actually delivers
