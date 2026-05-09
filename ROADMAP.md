# E-Migration Assist — CRM Roadmap (revised, post-pricing PDF)

Last updated: 9 May 2026.
Supersedes the earlier 6A → 6I plan; the original sequence assumed a sales-led
CRM, the pricing model in `attached_assets/E-Migration_Assist_–_Pricing_&_Package_Structure_v3*.pdf`
shows this is a tiered SaaS subscription product with a high-touch sales motion
sitting only at the top end (Enterprise + Premium Concierge).

---

## Why the plan changed

The pricing PDF locks in **9 commercial tiers across two motions**:

| Motion | Tiers | Acquisition |
|---|---|---|
| **Self-serve B2C** | Free / Basic R99 / Plus R249 / Pro R599-1200 / Premium R1200-1500 | Sign-up → Stripe checkout |
| **Light-touch B2C** | Pro / Premium upgrade paths | One-call sales assist |
| **Sales-led B2B** | Starter R850 / Growth R1,600 / Scale R2,800 / Enterprise (custom) | 14-day pilot trial → close |
| **White-glove** | Premium Concierge R45k–R250k+ | Dedicated specialist |

**Implication:** The current 9-stage funnel is right for ~5% of leads (Enterprise,
Concierge, large firms) and overkill for ~80% of leads (B2C subscribers who'll
just hit a Stripe checkout). Every downstream phase needs to be tier-aware.

---

## Roadmap

### ✅ Phase 6A — B2B contact intelligence (shipped 9 May 2026)
Hover-card on the email pill renders contact name / role / org / relationship /
email-type for professional rows, with heuristic fallbacks when role and
relationship aren't populated.

### ✅ Phase 6A.1 — Funnel trim (shipped 9 May 2026)
Dropped `awaiting_response` from the lead-status enum. 10 → 9 stages.

### ✅ Phase 6A.5 — Tier-aware lead intent (shipped 9 May 2026, v1)
Adds a single new column and surfaces it everywhere it matters. Unblocks
every other phase below because scoring rules, SLAs, and nurture cadences
all need to know which tier the lead is heading toward.

- New column: `prelaunch_leads.intended_tier text` — nullable. Allowed values:
  `free`, `basic`, `plus`, `pro`, `premium`, `starter_firm`, `growth_firm`,
  `scale_firm`, `enterprise`, `concierge`, `unknown`.
- Capture path:
  1. Public assessment — derive from existing `inquiryType` + `leadType` + new
     "What level of help do you need?" Step-7 question.
  2. Manual edit — dropdown on lead-detail page.
  3. Import pipeline — column mapping in CSV import.
- Surface in:
  - Leads-table column (filterable / sortable).
  - Tier-mix widget on the dashboard (alongside lead-mix charts).
  - Audience-query builder (new field).
  - `AdminLeadListItem` slim schema.
- **No public form schema break** — column is nullable, default null.

### Phase 6B — Tier-aware lead scoring (4–6 days)
Same event-sourced design we agreed on — but **two scoring rubrics**:

- **Self-serve rubric** scores upgrade propensity (Free → Basic, Basic → Plus, …).
  Inputs: pricing-page visits, document uploads, assessment depth completed,
  consultation booking attempts.
- **Sales rubric** (the original 8-rule version) scores deal readiness for
  Concierge, Enterprise, and Firm tiers. Inputs: persona match, demo
  requested, proposal opened, multi-touch engagement.

Tables:
- `lead_events (id, lead_id, type, points, payload jsonb, occurred_at)` — append-only.
- `lead_scores_snapshot (lead_id PK, total int, rubric text, computed_at)`
  — recomputed by the in-process worker.

Worker: lightweight `setInterval` tick at 60s, processes events created since
last `computed_at`. Process-local — no redis dep.

UI: existing `LeadScoreBadge` swaps from the static derivation to the snapshot;
breakdown tooltip lists the contributing events.

### Phase 6C — Stripe Billing integration (6–10 days, foundational)
**Re-prioritised into the critical path.** Without billing infrastructure,
scoring is optimising for a conversion event that can't actually happen.

Scope:
- Stripe Products/Prices for all 9 subscription tiers (multi-currency optional —
  ZAR primary).
- Stripe Customer record on lead → user promotion.
- Checkout Session creation for self-serve flow (Free → Basic etc).
- Customer Portal for upgrades / downgrades / payment-method updates.
- Subscription webhook receiver: `customer.subscription.{created,updated,deleted}`,
  `invoice.{paid,payment_failed}` → write to a new `subscriptions` table.
- Entitlement helper: `getTierFor(userId)` reads from `subscriptions`, used by
  app gating.
- Trial logic: 14-day pilot for firm tiers (Starter / Growth / Scale) with
  case-volume + export caps enforced by the entitlement helper.

Note: requires a `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. A Replit
Stripe integration exists; we'll use it to avoid manual key management.

### Phase 6D — Tier-driven SLA tracking (3–4 days)
The pricing PDF *contracts* specific response SLAs per tier:
Starter 24-48h, Growth 12-24h, Scale <12h, Concierge dedicated. So this
becomes a compliance feature, not a nice-to-have.

- New table: `sla_clocks (lead_or_case_id, tier, started_at, deadline_at,
  paused_at, met_at)`.
- Clock starts on inbound message / new ticket / lead-create.
- Operator dashboard widget: "SLAs at risk" (deadline within 4h, no response).
- Email alert to assigned operator at 50% / 90% of SLA window.
- Per-tier reporting: % of SLAs met, by month.

### Phase 6E — Resend / Twilio webhooks (2–3 days)
Wire delivery / open / click / bounce events from the existing transactional
providers into `lead_events` so the scoring rubric and the campaign Reports
panel can stop showing "not wired" placeholders.

- `POST /api/webhooks/resend` — verify Svix signature, write open/click/bounce
  events.
- `POST /api/webhooks/twilio/whatsapp/status` — verify HMAC, write delivery
  status.
- Update the campaign Reports panel to surface the now-real numbers.

### Phase 6F — Self-serve nurture (4–5 days)
5-touch / 14-day cadence for Free + Basic tiers (the long-tail self-serve
funnel). In-process interval worker (already greenlit).

- New table: `nurture_enrollments (lead_id, sequence_id, current_step,
  next_send_at, paused_at)`.
- Sequence definitions in code (`lib/nurtureSequences.ts`) — 3 sequences to
  start: Free welcome / Basic onboarding / Pro upgrade nudge.
- Enrolment triggers off `lead_events` (e.g. created → enrol in welcome;
  upgraded → unenrol from old, enrol in new).
- Pause-on-reply: any inbound WhatsApp/email kills the active sequence.

### Phase 6G — Inbound web forms (3–4 days)
Beyond the assessment flow — embeddable forms for partner sites, "request a
demo" CTA, "join the waitlist" landing pages. All write into the same lead
pipeline via the existing `POST /api/leads` with new `source` values.

### Phase 6H — Outbound sequences for sales tiers (5–7 days)
Manual sequences operators can enrol leads into for Concierge / Enterprise /
Firm trials. Differs from 6F nurture in that these are operator-triggered, not
event-triggered, and support task-step types (call reminders) alongside
email/WhatsApp steps.

### Deferred — FB / LinkedIn lead-ad ingestion
Documented in a separate writeup (still owed to user). Both require the user
to complete external account setup (FB Business Manager + LinkedIn Campaign
Manager) before any code can be written. Cost estimate after their accounts
are live: 2-3 days each, and they're independent of every other phase.

---

## Open questions for the user

1. **Stripe vs scoring first?** My recommendation is Stripe (6C) before
   scoring (6B) on the grounds that scoring without billing optimises for an
   event that can't convert. But scoring is faster (4-6 days vs 6-10) and
   demoable. Pick one.
2. **PUBLIC_BASE_URL** — needed for 6E. We can default to `$REPLIT_DEV_DOMAIN`
   in dev, but for production the prod domain must be set explicitly. OK to
   leave as a "set when deploying 6E" task?
3. **Tier capture in the assessment** — should Phase 6A.5 add the new Step-7
   "what level of help do you need?" question, or capture intended-tier
   purely operator-side / via Stripe-checkout-link reverse-mapping for now?
   Recommendation: operator-side only in 6A.5, defer the user-facing question
   until Stripe Checkout is live in 6C so the user actually sees the tier
   they're picking on the next screen.
