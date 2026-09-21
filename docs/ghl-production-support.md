# Production GHL support — implementation, not enablement

Production capture and delivery now run with `NODE_ENV=production`. Both remain
default-off. This change neither grants live-write approval nor changes deployed
environment variables. No application migration, real GHL request, setup write,
backfill, deployment, or AWS modification was performed.

## Exact environment contract

These are **future independently approved enablement requirements**, not an
instruction to turn on delivery now. Credential presence is never approval.

| Setting | Required value / purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `EMA_GHL_DELIVERY_MODE` | `production` (also required for production capture to pin the same destination contract) |
| `EMA_GHL_PRODUCTION_SCHEMA_APPROVAL` | `ALLOW_PRODUCTION_SCHEMA_V2`, only after reviewed migration |
| `GHL_LOCATION_ID` | Explicit reviewed production location |
| `EMA_GHL_APPROVED_PRODUCTION_LOCATION_ID` | Exactly the same location |
| `EMA_GHL_PIPELINE_ID`, `EMA_GHL_STAGE_ID` | Explicit reviewed pipeline and stage, never guessed |
| `EMA_GHL_FIELD_IDS_JSON` | Exact complete mapping of all 22 `contact.*` / `opportunity.*` keys in `fieldDefinitions`; nonblank, distinct IDs; none of the eight protected IDs |
| `EMA_GHL_CAPTURE_ENABLED` | Exact `true` enables the capture path; absent/anything else disables it |
| `EMA_GHL_PRODUCTION_CAPTURE_APPROVAL` | `ALLOW_PRODUCTION_CAPTURE`, required only for capture |
| `EMA_GHL_DELIVERY_ENABLED` | Exact `true` enables startup delivery; absent/anything else disables it |
| `EMA_GHL_PRODUCTION_DELIVERY_APPROVAL` | `ALLOW_PRODUCTION_DELIVERY`, required only for delivery |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Required only for delivery; never logged |

Production rejects any nonempty `EMA_GHL_TEST_LOCATION_ID`,
`EMA_GHL_APPROVED_TEST_LOCATION_ID`, `EMA_GHL_CONTROLLED_MANIFEST_JSON`,
`EMA_GHL_CONTROLLED_LIVE_APPROVAL`, or
`EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID`. Do not carry controlled-test
configuration into a production process. Existing synthetic delivery approval
does not substitute for either production approval.

Capture may run with delivery disabled; delivery may drain previously captured
work with capture disabled. Capture's pipeline/field configuration requirements
are intentional: both paths validate the same approved location and mapping.
Outbox scope is `(production, location)`, never development or test.

## Schema and preflight

Migration `lib/db/drizzle/0001_ema_ghl_outbox.sql` is unchanged.
The new additive `0002_ema_ghl_production.sql` expands only the two environment
CHECK constraints. A reviewed migration runner/release must package **both**
files and apply them in order, with backup and migration approval. Startup never
applies migrations. No production rows should be removed for rollback; reverting
the checks is unsafe after production rows exist.

Capture performs uncached read-only schema checks inside its existing atomic
transaction **before saving a lead**. Finalization checks before queueing.
Delivery checks schema before any provider request, then performs only GETs to
verify both models' field IDs/keys/types/options and the selected pipeline/stage.
Checks require all used table columns, validated exact production environment
constraints on both tables, enabled immutable-snapshot trigger and the valid
unique opportunity-ownership index. This is a readiness check, not a replacement
for migration integrity review or permission management.

Failure prevents capture writes or worker scheduling, with a redacted explicit
error code. Delivery preflight receipts are bound to the database, client and
unchanged configuration; manually constructing an unprepared production worker
fails. The transport additionally requires production delivery approval and
matching destination. Production rejects setup-field mutations and contact
upserts: a missing contact is created only after the existing independent
email/phone collision checks. Remote schema/configuration changes require
revalidation by restarting an approved process.

The existing worker's immutable snapshots, first-touch preservation, ownership
checks, six-operation durable outbox, leases, collision/replay protection and
unresolved-mutation barrier are retained. No automatic historical backfill is
added. Ambiguous writes still require reconciliation/operator review, not blind
retry or a newer write passing the barrier.

## Controlled live testing remains separately bounded

The existing three-record allowlist is unchanged and remains available only in
development/test with the isolated database harness, all original approvals and
preflight checks. Production cannot select that mode or reinterpret its consent.
The existing live sub-account is **not** an isolated GHL account. Recipient
consent covers only the user's controlled identity for those three synthetic
assessments, not staff, forwarded messages, marketing opt-in or workflow changes.

Production enablement still needs independent approval, reviewed destination and
field mapping, applied/verified schema, and notification-recipient safety.
The bounded test approval need not be requested again; its unresolved collision,
automation-recipient and other preflight gates still apply.

## Local evidence

Run from the repository root:

```sh
pnpm --filter @workspace/api-server exec vitest run src/lib/ghl/ghl.test.ts src/lib/ghl/http-runtime.test.ts src/lib/ghl/controlled.test.ts src/lib/ghl/routes.test.ts src/lib/ghl/setup.test.ts src/lib/ghl/production.test.ts
pnpm --filter @workspace/api-server typecheck
```

All database fixtures use fresh in-memory PGlite, not `DATABASE_URL`. Production
regressions exercise both SQL migrations only in that isolated fixture, real
production capture/outbox scope, fail-closed gates/schema/provider metadata,
the real runtime/HTTP client with intercepted fetch, six confirmed operations,
and replay without additional mutations. Existing suites retain collision,
first-touch, delayed completion and ambiguity coverage.

Verified locally: **6 files, 149 tests passed** (128 existing + 21 production
regressions); API TypeScript typecheck passed.

These are mocked-provider tests, **not actual GHL delivery** and not full
published-form-to-GHL verification. The separate routes suite verifies local
intake behavior with mocks; it does not expand live-write permission.