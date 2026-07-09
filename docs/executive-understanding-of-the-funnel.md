# Executive Understanding of the Funnel

*The one-document answer to: "If I had to explain this funnel as a full operating system for lead capture, qualification, conversion preparation, outreach, and referral — how does it work end to end, and which code matters most?"*

## The system in one paragraph

This repo is a **lead operating system** that sits in front of the main E-Migration Assist platform. It captures immigration prospects through three public assessment funnels, verifies them (OTP), scores and qualifies them in an admin CRM, nurtures them with email/WhatsApp campaigns, converts the ready ones into cases, and — with explicit consent — hands matched leads to partner immigration firms inside the main EMA platform through a cryptographically signed, PII-safe referral tunnel. It never IS the main platform: it is the sender, the feeder, the top of the machine.

## The five engines

### 1. Capture
Three funnels (`/assessment`, `/overstay`, `/business`) feed one `prelaunch_leads` table. Submission is two-phase: the record commits at the Terms step, but nothing is sent until the user finalizes — and the confirmation fires at most once, ever. Reference numbers appear only on the thank-you page. Bots are absorbed silently (honeypot), abuse is rate-limited on three independent axes (IP, email, WhatsApp), and every contact is OTP-verified (WhatsApp first, email fallback).

### 2. Qualification
The admin CRM (`/admin`) is a pipeline of 10 statuses that operators can move in both directions — with one hard, race-proof gate: only a `ready_for_case` lead can become `converted`, and that same action creates its case. Around the pipeline: event-sourced lead scoring (recomputed every 60s), append-only internal notes, ownership, follow-ups that can't outlive their due dates, archive/delete, and an append-only audit trail behind every privileged action.

### 3. Outreach
A campaign engine with reusable templates, a strictly allow-listed audience builder (no accidental send-to-all, no SQL injection), exactly four merge tokens (no template logic — by design), sanitized rich text, and a durable background queue that claims each recipient atomically (no double-sends), honours unsubscribes, and finalises exactly once. Compliance is built in: HMAC-signed one-click unsubscribe, POPIA-conscious throughout.

### 4. Conversion preparation
Converted leads get exactly one case (idempotent), a workflow auto-attached, and a forward-only case lifecycle. The client-portal machinery (prepare → activate) flips status columns race-safely, and an **activation email** can now be sent (at-most-once, atomic claim, audited) — but actual client login/credentials remain a future phase.

### 5. Referral (the revenue hand-off)
On explicit consent, the funnel asks the main EMA platform — the *sole* matcher — for a partner firm. A match stores only the firm's ID, emails the firm a redacted preview with EMA's signed accept link, and waits for EMA's terminal, idempotent "converted" callback. No match means an honest unmatched record and no email — never a fake. The referrals table structurally cannot hold applicant PII: the columns don't exist.

## What makes this codebase trustworthy

- **Fail-closed everywhere:** webhooks, the referral tunnel, unsubscribe signing, and cross-origin cookies all refuse to operate rather than operate insecurely. Dev bypasses are hard-refused in production.
- **Idempotency as a habit:** confirmation sends, case creation, campaign claims, portal transitions, lifecycle executions, referral callbacks — all safe to retry.
- **Honest state:** unmatched referrals are recorded as unmatched; known defects live in the test suite as expected failures; unfinished features are visibly stubs, not silent fakes.
- **Audit spine:** every privileged action appends to `lead_audit` with a hashed actor and PII-free payloads — the timeline the whole CRM reads.

## What to watch (founder risk register)

1. **The EMA boundary is the fragile edge.** Both sides must share the same secret and URL; the match-response shape has drifted once already (now parsed dual-shape). Any EMA-side contract change lands here first. Offer emails currently depend on EMA including the firm's contact email in the match response.
2. **Deployment is split** (Vercel frontend / Replit backend); a wrong `VITE_API_URL` makes the live site hit the wrong backend while the replit.app preview looks fine.
3. **The queue needs a Reserved VM** — autoscale silently breaks campaigns and scheduling.
4. **Email lives or dies on Resend domain verification** for `noreply@emigration-assist.com`; WhatsApp templates must be genuinely approved in Twilio (delivery fails silently otherwise).
5. **Two known intake defects** (invalid email accepted; invalid WhatsApp silently dropped) are documented, not fixed.
6. **Dormant surfaces** — lifecycle automations, actual client portal access (activation emails send, but no client login exists), four admin stub pages — are scaffolds awaiting future phases; don't mistake them for working features.

## Which code matters most

The money path is ~10 files: `routes/leads.ts` → `lib/confirmation.ts` → `lib/classification.ts`/`routes/adminLeads.ts` → `lib/cases.ts` → `lib/referralTunnel.ts`/`routes/referrals.ts`, plus the delivery layer (`lib/email.ts`, `lib/whatsappClient.ts`, `lib/campaignSendWorker.ts`). Everything else supports, decorates, or observes that path. Full breakdown: `docs/code-relevance-map.md`.

## The rest of this analysis set

| Doc | Contents |
|---|---|
| `full-funnel-architecture-analysis.md` | System architecture, deployment, EMA boundary |
| `full-funnel-workflows.md` | All 18 workflows A–R end to end |
| `frontend-routes-map.md` / `backend-routes-map.md` | Every page and every endpoint |
| `database-domain-map.md` | Every table and who owns the data |
| `business-rules-and-invariants.md` | Every rule the code enforces |
| `services-jobs-and-integrations.md` | Email, WhatsApp, queue, storage, tunnel, webhooks |
| `testing-maturity-analysis.md` | What's tested, what's honestly not |
| `code-relevance-map.md` | Which files matter to whom |
