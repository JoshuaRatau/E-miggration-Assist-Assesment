---
name: Funnel landing route map
description: How the public home page routes the 4 funnel entry points, and two non-obvious decisions to preserve.
---

# Funnel landing route map (home.tsx)

The public landing (`artifacts/emigration-assist/src/pages/home.tsx`) is a problem-led
routing layer with 4 primary routes, each opening an EXISTING intake (no new questionnaires):

- Traveller → `/assessment`
- Overstayed / Undesirable → overstay intake (see absolute-URL note below)
- Firm / Professional → `/business-assessment`
- Continue with Reference → `/status`

Two premium-priority "urgent pillars" sit above the route grid: overstay and
stuck/delayed applications.

## Decision 1 — overstay route uses a hardcoded ABSOLUTE URL on purpose
The overstay CTA links to `https://immigrationassist.replit.app/overstay-assessment`
(an absolute `<a>`), NOT a Wouter `<Link href="/overstay-assessment">`, even though
`/overstay-assessment` is a valid client route in `App.tsx`.
**Why:** this is the pre-existing production routing behaviour; the split Vercel/Replit
deploy topology means in-app navigation for overstay was deliberately bypassed. A
`RouteCTA` helper renders `<a>` when `external:true`, `<Link>` otherwise.
**How to apply:** do NOT "clean this up" into a Wouter Link without verifying the live
Vercel + marketing-site rewrite still resolves it — switching it can break prod. If you
must, externalize to a config/env var with the current absolute URL as the fallback.

## Decision 2 — "stuck application" has NO dedicated route; it funnels to /assessment
The brief caps the funnel at 4 routes but names 2 problem pillars (overstay + stuck
applications). Overstay has its own intake; stuck/delayed/mismatched applications route
to the general individual assessment (`/assessment`, the "Traveller" intake).
**Why:** hard constraint — reuse existing intakes, add no new questionnaire/route.
**How to apply:** there is intentionally no `entry=stuck` discriminator passed forward
(it would be inert since the questionnaire can't be changed). Only add one if a future
task explicitly wants analytics/ops distinction AND accepts a non-schema query hint.
