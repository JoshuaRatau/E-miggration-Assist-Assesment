---
name: Admin dashboard segment model
description: How the 4-way operator segment (all/individual/overstay/business) is derived and its known lossy interaction with Saved Views.
---

# Admin dashboard segment model

The Lead Intelligence dashboard splits leads into 4 operator segments without any
schema change — all derived in `src/lib/leadSegment.ts` from already-serialized
fields:

- **business** = `leadType === "professional"`
- **overstay** = individual AND (`leadCategory === "overstay"` OR `immigrationSituation` ∈ overstay/undesirable/prohibited/expired)
- **individual** = individual AND not overstay
- **all** = everything

**Why client-side overstay:** `GET /api/leads` only filters `leadType` (individual|professional).
Overstay is therefore a CLIENT sub-filter of individuals — `serverLeadTypeFor()`
maps both `individual` and `overstay` to the server's `individual`, then the table
narrows further in `visibleLeads`. The dashboard KPI strip / segment counts /
critical-overstay banner read a separate filter-free `metricsLeads` query
(limit 5000, archive-scoped), NOT the table query, so they stay stable as filters change.

**Saved Views are lossy for overstay (by design, V1):** `savedViews.ts` persists a
3-way segment (`ALL`|`individual`|`professional`). The dashboard maps `business→professional`,
`all→ALL`, and BOTH `individual` and `overstay → individual`. So an overstay-specific
view round-trips as plain individual.
**How to apply:** if a later phase needs overstay to persist in Saved Views, extend
the SavedViewFilters segment type — don't try to smuggle it through the 3-way shape.
