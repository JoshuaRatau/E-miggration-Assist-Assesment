---
name: Adding a lead_status value
description: Where to add a new lead_status funnel value and why no migration is needed
---

# Adding a new `lead_status` value

`prelaunch_leads.lead_status` is a **`text` column, NOT a Postgres enum** — adding a
value needs **no migration / no `db:push`**. Values are validated at the app layer
only (PATCH allow-list = `LEAD_STATUS_VALUES` in `classification.ts`; the GET list
filter uses plain equality with no allow-list).

**Why this matters:** the status set is hardcoded/mirrored in ~9 independent sites.
Miss one and the value silently drops out of a dropdown/filter/kanban or fails
typecheck. `rg` mangles snake_case identifiers in output — trust the `read` tool for
exact values, use `rg -l` only to find which files enumerate them.

**Sites that must stay in sync** (anchor a search on `proposal_sent`):
- `artifacts/api-server/src/lib/classification.ts` — `LEAD_STATUS_VALUES` (canonical) + `NEXT_STEP_BY_STATUS` hint map
- `artifacts/emigration-assist/src/lib/leadStatus.ts` — `LEAD_STATUS_ORDER` (frontend mirror + `LeadStatus` type)
- `artifacts/emigration-assist/src/pages/admin.tsx` — `STATUS_VALUES` + `STATUS_OPTIONS` (filter labels)
- `artifacts/emigration-assist/src/pages/admin-lead-detail.tsx` — `STATUS_OPTIONS`
- `artifacts/emigration-assist/src/components/admin-dashboard/lead-drawer.tsx` — `STATUS_VALUES`
- `artifacts/emigration-assist/src/components/audience-query-builder.tsx` — `ENUM_VALUES.leadStatus`
- `artifacts/emigration-assist/src/components/lead-pipeline-board.tsx` — `COLUMN_HEADER_CLASS` is `Record<LeadStatus,string>` → **type-required**, TS breaks if omitted
- `artifacts/emigration-assist/src/lib/leadScore.ts` — `FUNNEL_WEIGHTS` (legacy score fallback only; Phase 6B is event-sourced)
- `artifacts/emigration-assist/src/lib/leadSegment.ts` — `IN_PROGRESS_STATUSES` / `TERMINAL_STATUSES` sets (drive KPI counts)

**Not runtime (safe to leave / doc-only):** OpenAPI `lead_status` has **no `enum:` constraint**, only description text — updating it forces codegen churn for zero behaviour change, so skip it. Comments in `schema/leads.ts` + `adminLeads.ts` are doc-only.

**Label rendering:** `statusLabel()` in `leadStatus.ts` auto-converts snake_case → Title Case (`needs_more_information` → "Needs More Information"), so no explicit label needed except in `admin.tsx` `STATUS_OPTIONS`.

**Transition invariant:** placement in the array is low-risk — the only hard rule is the `converted` predecessor lock (must come from `ready_for_case`), enforced by an atomic WHERE clause in the PATCH route. The funnel is otherwise bidirectional.
