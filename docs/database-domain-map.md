# Database & Domain Model Map (Drizzle — `lib/db/src/schema/`)

PostgreSQL. Schema split by domain, one file each. Statuses are TEXT columns (no enum migrations) — values are enforced in code.

## Core funnel (high PII — funnel-owned)

| Table | Represents | Key points |
|---|---|---|
| `prelaunch_leads` | The central lead record (B2C individual or B2B professional) | `reference_number` (unique, human-readable), `lead_type`, `lead_status` (9+1 stage pipeline), `lead_score`, `intended_tier`, `assigned_to` (uuid **soft-ref** to admin_users, NO FK), `next_follow_up_at` + `follow_up_note`, `tags[]`, `archived_at` (soft archive), `funnel_context` (jsonb route/theme attribution), `admin_notes` (editable blob — distinct from append-only notes), 10 professional-lead columns, honeypot never stored. |
| `lead_cases` | Conversion record — bridge to case management | One per lead (`UNIQUE(lead_id)`); `workflow_status`/`workflow_key` (auto-attach), `portal_status` (`not_prepared → ready_to_activate → activated`, terminal; or `manual_review_required`), `reference_number` snapshot. Forward-only case statuses. |
| `prelaunch_documents` | Uploaded assessment documents | Session-scoped listing (`sessionStartedAt` cutoff); server-side type allow-list. |
| `lead_otps` | Short-lived OTP records | SHA-256-hashed codes, 10-min TTL, max 5 attempts, consumed-once. |

## Engagement & communication (contact PII)

| Table | Represents |
|---|---|
| `lead_engagements` | Every outbound send (confirmation, updates, campaign copies). The `confirmation` row is the at-most-once guard for finalize. |
| `case_messages` | Inbound replies (WhatsApp webhook). |
| `campaigns` | Bulk-send metadata: audience filter (jsonb, compiled by allow-listed query compiler), channel, status (`draft→sending→completed`, `scheduled`, paused), aggregate tallies. |
| `campaign_recipients` | Fan-out junction; idempotent via `UNIQUE(campaign_id, lead_id)`; atomic per-recipient claim. |
| `unsubscribes` | Global opt-out registry (holds email/WA strings — required to enforce suppression). |
| `comm_templates` | Reusable message bodies; subject required for email; channel locked after create; archived rows immutable. |

## Intelligence & automation (non-identifying)

| Table | Represents |
|---|---|
| `lead_events` | Append-only event stream powering scoring; points-per-event snapshotted into each row so history is immutable. ~60s recompute lag is accepted. |
| `lifecycle_rules` / `lifecycle_executions` | Automation scaffold. 3 starter rules seeded **disabled**; `UNIQUE(rule_id, lead_id, triggered_by)` makes duplicate delivery a no-op. **No worker exists yet — read-only phase.** |
| `analytics_events` | Funnel analytics (allow-listed event names). |

## Referral tunnel (ZERO applicant PII — structural guarantee)

| Table | Represents |
|---|---|
| `referrals` | Hand-off tracking. **Has NO name/email/phone columns by design** — applicant PII travels only inside the signed push body to EMA. Stores `ema_firm_id` (EMA is the sole matcher), status (`offered → preview_viewed → … → converted` terminal), non-identifying matter summary. |
| `referral_audit` | Append-only tunnel stage log — reason codes/constants only, never raw provider strings or PII. |
| `partner_firms` | Local firm directory with admin CRUD (`/admin/partner-firms`). **No longer the matching source** — the EMA match API is authoritative for referral matching — but the table and its admin routes remain live. |

## Administration & system

| Table | Represents |
|---|---|
| `admin_users` / `admin_sessions` / `admin_password_resets` | Admin auth: roles (superadmin gate), opaque sessions (7-day TTL), 1-hour single-use hashed reset tokens. Demo superadmin seeded if empty. |
| `lead_audit` | **The backbone.** Append-only log of every privileged mutation AND internal notes (`action="lead_note_added"`). Actor credential sha256-hashed; before/after snapshots; assignee names snapshotted so timeline renders join-free. Survives lead deletion. |
| `import_jobs` / `import_job_rows` | CSV/XLSX import pipeline; raw source rows retained for audit. |
| `support_requests` | Support-widget submissions, mirrored to external Eride Support Hub (`hub_ticket_reference` written back). |
| `billing_subscriptions` / `billing_payments` / `billing_ingest_events` / `billing_unmatched` | Revenue **mirror** — sole writer is the signed inbound billing webhook from main EMA. `billing_unmatched` is the reconciliation queue. |

## Data ownership rules

- **Funnel-owned:** leads, documents, engagements, campaigns, scoring, audit.
- **Hand-off related:** `lead_cases` (portal prep), `referrals`/`referral_audit` (tunnel), `billing_*` (inbound mirror).
- **Must NEVER come from main EMA:** applicant lead records themselves — this repo is the sender; the only inbound EMA data is billing events and referral status callbacks.
