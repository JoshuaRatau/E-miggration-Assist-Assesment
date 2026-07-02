---
name: Segment intake funnel pattern
description: How new public assessment segments (overstay, business/firm, future ones) are added to E-Migration Assist.
---

# Segment intake funnel pattern

New public "segment" funnels (traveller = `/assessment`, overstay = `/overstay-assessment`,
firm/professional = `/business-assessment`) all follow the SAME convention. When adding a
new segment, mirror the overstay pair rather than inventing a new shape:

- **Dedicated frontend page** under `artifacts/emigration-assist/src/pages/<segment>-assessment.tsx`,
  multi-step, plain `useState<FormState>` (NOT react-hook-form), copying overstay's shell:
  `BrandHeader`, dark card, step progress, Back/Continue, success/reference screen with copy
  button + `/status?ref=` link + honeypot field. Wire routes in `App.tsx` and a CTA on `home.tsx`.
- **Dedicated backend route** `artifacts/api-server/src/routes/<segment>Intake.ts` →
  `POST /api/<segment>-intake`, registered in `routes/index.ts`. Mirror overstayIntake:
  honeypot, IP rate-limit, dedup by lowercased email + normalized WhatsApp → 409 with prior
  reference, zod `Body`, insert in try/catch, `recordLeadEvent` lead_created + assessment_completed,
  reference `EMA-<CODE>-YYYY-XXXX`.
- **No new DB columns, no OpenAPI, no codegen.** Map onto EXISTING `prelaunch_leads` columns and
  stash the rich segment-specific answers as a JSON blob in `admin_notes`. These bespoke intake
  routes are intentionally NOT in `openapi.yaml`.

**Why:** keeps segments additive and low-risk — no migration, no schema churn, no regression to
existing funnels. Matches how overstay was shipped.

**How to apply:** backend must be the source of truth for required fields (frontend gates are not
enough) — enforce non-empty required answers and conditional requireds (e.g. via zod `superRefine`)
so direct API calls can't create incomplete leads.
