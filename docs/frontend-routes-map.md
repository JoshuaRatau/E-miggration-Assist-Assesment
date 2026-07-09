# Frontend Routes Map (Wouter SPA — `artifacts/emigration-assist`)

Authoritative route list from `src/App.tsx`. Admin routes are wrapped in an auth guard.

## Public funnel routes

| Path | Page file | Serves | Purpose / API calls |
|---|---|---|---|
| `/` | `pages/home.tsx` | Visitors | Landing + 4-route funnel selection. Calls `GET /api/stats/summary`. Note: the overstay CTA uses a hardcoded absolute URL on purpose (don't convert to a Wouter Link). |
| `/assessment` | `pages/assessment.tsx` | Individual leads | 5-step (dynamic 7/8 with upload gate) assessment. Calls `POST /api/otp/request`, `POST /api/otp/verify`, `POST /api/leads` (finalize:false at Terms), `POST /api/leads/:id/finalize`, document upload/list. "Stuck application" traffic also funnels here (no dedicated route). |
| `/overstay-assessment`, `/overstay` | `pages/overstay-assessment.tsx` | Overstay/undesirable leads | Segment funnel; submits `POST /api/overstay-intake`. Rich answers stored as JSON in admin notes (no new DB columns). |
| `/business-assessment`, `/business` | `pages/business-assessment.tsx` | Firms/practitioners (B2B) | Segment funnel; submits `POST /api/business-intake`. |
| `/thank-you/:reference` | `pages/thank-you.tsx` | Just-submitted leads | Reference-number reveal (the ONLY place it is first shown) + next steps. `GET /api/leads/:referenceNumber`. |
| `/status` | `pages/status.tsx` | Returning leads | Public status lookup by reference number (no login). `GET /api/public/status/:referenceNumber`. |
| `/pricing`, `/prices` | `pages/pricing.tsx` | Visitors | Package/tier disclosure. |
| `/referral-preview/:referralId` | `pages/referral-preview.tsx` | Partner-firm viewers | Redacted, non-PII referral preview. |
| unsubscribe landing | served by the API (`GET /api/unsubscribe`), not the SPA | Recipients | One-click unsubscribe. |

## Admin routes (auth-guarded)

| Path | Page file | Purpose |
|---|---|---|
| `/admin/login` | `admin-login.tsx` | Email+password login (session cookie). |
| `/admin/forgot`, `/admin/reset/:token` | `admin-forgot.tsx`, `admin-reset.tsx` | Password reset (1-hour single-use token). |
| `/admin` | `admin.tsx` | Command centre: KPI strip, pipeline kanban, lead list, drawer, filter chips, saved views, 4-way segment model (segment derived client-side; overstay is a sub-filter of individuals). |
| `/admin/lead/:id` | `admin-lead-detail.tsx` | 360° lead view: status, notes, owner, follow-ups, engagements, timeline, convert action, Client Portal card (prepare → activate). Fetches the FULL lead via `/api/leads/by-id/:id` (the slim list omits `adminNotes`). |
| `/admin/case/:caseId` | `admin-case-detail.tsx` | Post-conversion case lifecycle (forward-only statuses). |
| `/admin/communications` (+ `/templates`, `/automations`, `/reports`, `/notifications`) | `admin-communications.tsx` | Comms hub tabs: campaigns, reusable templates, (read-only) automations, reports, notifications. |
| `/admin/communications/campaigns/:id` | campaign detail view | Campaign status/counters. |
| `/admin/communications/campaigns/:id/edit` | `admin-campaign-editor.tsx` | Audience query builder + TipTap rich composer, preview, send (202 + polling), schedule, pause/resume. |
| `/admin/campaigns`, `/admin/campaigns/:id`, `/admin/campaigns/:id/edit` | legacy redirects | Redirect to the `/admin/communications/...` equivalents. |
| `/admin/referrals` | referrals page | Referral tunnel tracking (non-PII rows + audit trail). |
| `/admin/import` | `admin-import.tsx` | Bulk CSV/XLSX lead import. |
| `/admin/exports` | `admin-exports.tsx` | Data export. |
| `/admin/users` | `admin-users.tsx` | Superadmin-only admin management. |
| `/admin/profile` | `admin-profile.tsx` | Operator settings. |
| `/admin/subscriptions` | `admin-subscriptions.tsx` | Billing mirror (revenue pushed from main EMA). |
| `/admin/analytics`, `/admin/reports`, `/admin/support`, `/admin/pipelines` | `admin-stub.tsx` | **Stubs** — navigation chrome only, no functionality yet. |

## Notes for founders

- The public brand everywhere is **E-Migration Assist**; "EMA Leads Funnel" is internal only.
- The Meta Pixel fires PageView / ViewContent / Lead / SubmitApplication / Contact only (client-side, no PII sent; base ID in `index.html`).
- Frontend calls to bespoke admin routes attach the session cookie (and legacy `x-admin-token`) with `credentials: "include"` — required for the cross-origin Vercel→Replit setup.
