---
name: adminNotes not in slim leads list
description: Why any inline/drawer notes editor on the admin dashboard must fetch the full lead, not read the list row.
---

# adminNotes is omitted from the slim leads list

`GET /api/leads` returns the slim `AdminLeadListItem` serializer, which **intentionally omits `adminNotes`** (and other internal "rules engine" fields). So a `Lead` object taken from the list cache always has `adminNotes === undefined`.

**Why it matters:** any UI that reads or edits notes from a list row will (a) never show existing notes and (b) compute a dirty/changed flag against `""`, so a save can never clear the dirty state and the value won't survive a list refetch.

**How to apply:** to read/edit `adminNotes` (or other omitted internal fields), fetch the full lead via the admin-gated `GET /api/leads/by-id/:id` (requires `x-admin-token` / `credentials: include`). Key it in React Query as `["admin","lead", id]` — the same key the lead-detail page uses — so edits stay consistent across both surfaces. On save (PATCH `/api/admin/leads/:id` with body `{ notes }`, which the server maps to `adminNotes`), write the authoritative PATCH response back into that key so the dirty check clears immediately and the value persists on reopen.
