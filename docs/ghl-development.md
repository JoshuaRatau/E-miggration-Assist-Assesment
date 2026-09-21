# EMA direct-API integration: development implementation

## Safety and status

This implementation remains restricted to development/test, but it is no longer
mock-only: it now contains a real fixed-host HTTP client, a gated delivery
runtime, startup/shutdown wiring, and a separately gated field-setup client.
No live GHL call or change, application-database migration, historical replay,
AWS change, push, or deployment was performed. Every HTTP path exercised by
tests used an intercepted transport, and database tests used isolated PGlite.

* `captureEnabled()` defaults to false. With capture disabled the routes use
  their original save path and never query the new tables.
* Optional capture requires `NODE_ENV != production`,
  `EMA_GHL_CAPTURE_ENABLED=true`, and `EMA_GHL_TEST_LOCATION_ID`.
  Capture and delivery are independent: enabling either does not enable the
  other.
* Delivery defaults off unless `EMA_GHL_DELIVERY_ENABLED=true`. The disabled
  path returns before reading credentials, importing/querying the database,
  constructing the worker, scheduling a timer, or making an HTTP request. It
  therefore has no dependency on the six new tables while disabled.
* Enabled delivery additionally requires `NODE_ENV=development|test`,
  `EMA_GHL_DELIVERY_APPROVAL=ALLOW_SYNTHETIC_TEST_DELIVERY`,
  `GHL_LOCATION_ID` exactly equal to
  `EMA_GHL_APPROVED_TEST_LOCATION_ID`, and, when set,
  `EMA_GHL_TEST_LOCATION_ID` equal to that same destination. It also requires
  `GHL_PRIVATE_INTEGRATION_TOKEN`, `EMA_GHL_PIPELINE_ID`,
  `EMA_GHL_STAGE_ID`, and a complete `EMA_GHL_FIELD_IDS_JSON` mapping for all
  22 definitions.
* `HttpGhlClient` sends GHL v3 requests only to the fixed
  `https://services.leadconnectorhq.com` host and an endpoint allowlist. It
  refuses redirects, unsafe paths, destination mismatches, missing approval,
  writes without explicit write allowance, and production environments before
  transport. It validates provider response shapes and does not internally
  retry mutations.
* `src/index.ts` now calls `startGhlDelivery()` after the server starts and
  stops it during graceful shutdown. Configuration failures are logged as a
  startup configuration error; with delivery disabled, the runtime is inert.
* Pipeline, stage and all custom-field IDs are supplied explicitly by
  environment-derived `GhlConfig`. No production IDs are embedded or selected.
* SQL environment checks accept development/test only. Production requires a
  separate reviewed code and schema release; changing an environment switch
  cannot enable it.

## Changed behaviour and preservation

The three intake routes retain their validation, lead attributes, duplicate
`409 already_registered` response/reference, scoring and notification calls.
No form design or firm page blue theme was changed.

With optional capture enabled:

* Individual initial save atomically stores the existing lead and its immutable
  validated answers. It does not queue delivery, even for legacy `finalize:true`
  callers. The explicit finalisation endpoint completes the snapshot and inserts
  six delivery operations transactionally. Notification history cannot suppress
  this durable completion step. Repeating finalisation does not duplicate work.
* Overstay and business save lead, snapshot, completion and six operations in
  one transaction. Failed snapshot/outbox work rolls back the lead save.
* Existing leads without a snapshot are not reconstructed from mutable notes.
* The frontend checks HTTP success **and** `finalized:true` before marking
  complete, firing the success pixel, or navigating. Failure leaves the saved
  reference intact and shows a retry message for either upload or skip path.

Snapshots exclude OTP proof, honeypot, finalisation control and `adminNotes`.
All validated assessment answers and recorded consent are preserved. Attribution
uses the same existing sanitizer; absent UTM values remain absent.

## Exact proposed GHL fields

All definitions are exported from `src/lib/ghl/fields.ts`. IDs are intentionally
not supplied. `logical key` below is our configuration identifier, not a promise
that GHL generates the same `fieldKey`. A future approved setup must record each
returned provider ID and verify its model/type/options.

| Model | Logical key | Exact display name | GHL type | Options |
|---|---|---|---|---|
| contact | `ema_lead_id` | EMA Lead ID | TEXT | — |
| contact | `ema_reference` | EMA Reference | TEXT | — |
| contact | `ema_latest_submission_id` | EMA Latest Submission ID | TEXT | — |
| contact | `ema_assessment_type` | EMA Assessment Type | SINGLE_OPTIONS | individual, overstay, business |
| contact | `ema_latest_completed_at` | EMA Latest Completed At | TEXT | ISO-8601 UTC timestamp |
| contact | `ema_assessment_consent` | EMA Assessment Consent | SINGLE_OPTIONS | accepted, not-recorded |
| contact | `ema_consent_at` | EMA Consent At | TEXT | ISO-8601 UTC timestamp |
| contact | `ema_preferred_contact_channel` | EMA Preferred Contact Channel | SINGLE_OPTIONS | email, whatsapp, phone |
| contact | `ema_whatsapp_number` | EMA WhatsApp Number | TEXT | — |
| contact | `ema_whatsapp_opt_in` | EMA WhatsApp Opt-in | SINGLE_OPTIONS | yes, no, not-recorded |
| contact | `ema_source` | EMA Source | TEXT | — |
| contact | `ema_source_campaign` | EMA Source Campaign | TEXT | — |
| contact | `ema_utm_source` | EMA UTM Source | TEXT | — |
| contact | `ema_utm_medium` | EMA UTM Medium | TEXT | — |
| contact | `ema_utm_campaign` | EMA UTM Campaign | TEXT | — |
| contact | `ema_funnel_context` | EMA Funnel Context | LARGE_TEXT | Captured JSON |
| contact | `ema_immigration_situation` | EMA Immigration Situation | SINGLE_OPTIONS | valid, expired, overstay, undesirable, prohibited, visa_required, unknown |
| contact | `ema_overstay_situation` | EMA Overstay Situation | SINGLE_OPTIONS | visa_expired, undesirable_declaration, overstayed_after_expiry, unsure_of_status, application_rejected_in_sa, missed_departure_deadline, other |
| contact | `ema_practice_areas` | EMA Practice Areas | MULTIPLE_OPTIONS | work_visas, permanent_residence, appeals, condonation, corporate_mobility, other |
| contact | `ema_annual_case_volume_band` | EMA Annual Case Volume Band | SINGLE_OPTIONS | <25, 25-99, 100-249, 250+ |
| opportunity | `ema_lead_id` | EMA Lead ID | TEXT | — |
| opportunity | `ema_reference` | EMA Reference | TEXT | — |

`GhlConfig.fieldIds` keys are model-prefixed, e.g.
`contact.ema_lead_id` and `opportunity.ema_lead_id`.

No existing field is reused or modified: Work Email, Biggest Challenge, Visa
Services Managed, Job Title, Work Phone Number, Monthly Case Volume,
Organization Type and Solution Timeline remain untouched.

### Original attribution versus latest assessment

EMA source, source campaign, the three UTM fields and full funnel context are
first-touch fields. If a matching GHL contact already has a nonempty value, the
worker omits that field from updates. Missing original values may be filled
from genuinely captured data; no missing source/medium/campaign is fabricated.
Every submission's attribution remains in its immutable snapshot/history note,
even when it differs from the preserved contact-level original attribution.

Latest submission/type/completion, consent and assessment fields are updated
only if this assessment is not older than the stored remote/local completion
watermark. Absent answer/opt-in values are omitted, not written as false/empty.
Standard name/email/phone/company/location values are mapped only when captured;
phone requires a syntactically valid international number. No surname or country
code is invented. No DND, tags, suppression or marketing-subscription fields are
written.

### History

One dated note per completed submission contains the reference, flow, validated
answers, captured consent, attribution and `[ema-submission:<uuid>]` marker.
It does not export raw internal `adminNotes`, document URLs or OTP material.
The initial conservative note limit is 10,000 characters; larger payloads are
held for explicit review, never silently truncated. Provider size limits and any
multi-part note policy remain release decisions.

## Additive SQL and durable state

`lib/db/drizzle/0001_ema_ghl_outbox.sql` creates:

1. `ema_assessment_submissions`: unique lead snapshot plus one-time completion.
2. `ema_ghl_operations`: six individually confirmed delivery/verification steps.
3. `ema_ghl_attempts`: per-API-action timestamps, controlled outcome codes/status.
4. `ema_ghl_links`: environment/location-scoped contact and opportunity IDs,
   one opportunity per EMA lead.
5. `ema_ghl_worker_leases`: per-location serialisation and expiring lease tokens.
6. `ema_ghl_mutation_barriers`: persistent unresolved-remote-mutation barrier.

A database trigger rejects answer/attribution/identity/capture-time rewrites and
any second completion timestamp change. Unique operation keys enforce repeated
finalisation idempotency. Foreign keys retain lead association.

The migration is an explicit transactional SQL migration, not registered in an
automatic startup runner. Do not use schema push for this change: it does not
install the immutable trigger. Before any application migration, establish the
actual database target/isolation, backup, reviewed migration history and runner.
The migration has only been applied to a fresh ephemeral PGlite instance in
tests. It is not a live-database migration compatibility claim.

## Delivery and failure handling

Required operation sequence:
`contact → contact_verify → history → history_verify → opportunity → opportunity_verify`.
The status helper returns synced only when all six are confirmed.

* Email and phone are resolved independently. Conflicting identities stop before
  mutation. Remote location/contact ownership is checked.
* Existing contact links are reused. The worker never clears unrelated fields.
* Notes are reconciled by exact submission marker and expected body.
* Opportunities are reconciled by EMA lead marker plus EMA lead custom field.
  Unmarked existing opportunities cause review, not automatic adoption.
* Opportunity response custom fields use `fieldValue`; contact response fields
  use `value`. Fixtures test these different provider contracts.
* A confirmed opportunity link is reused without resetting status or stage.
  No qualification, booking, value, won or lost rules are invented.
* Expired operation leases can be recovered. Scope and operation tokens fence
  local writes. Retries use bounded exponential backoff/jitter and Retry-After.
  Auth/configuration failures block; ambiguity/conflicts/exhaustion require review.
* A successful required record is read back before its verification confirms.
  If a strictly newer identified assessment supersedes contact fields between
  update and verification, the earlier assessment can still write its history.

### Late mutation safety

Local fencing cannot cancel an already executing remote HTTP mutation. A durable
scope barrier is persisted **before** each POST/PUT. Explicit success or
client/auth/rate-limit rejection removes it; an ambiguous outcome leaves it.
Other operations in that scope cannot advance while the barrier remains.

Lost create responses can be reconciled read-only from a unique matching remote
record, without repeating creation. If no match is found, the operation pauses
rather than resending. A timed-out PUT is stricter: it enters
`UNRESOLVED_UPDATE_REVIEW` and retains the scope barrier, even if the mock finishes
late. No automatic newer write can race it. Operators must establish remote
quiescence and assess remote values before any future reviewed recovery action.
There is deliberately no blind barrier-clear/replay command.

This sacrifices throughput/availability for safety. It does not claim remote
exactly-once execution or remote request cancellation.

## Reproducible safe commands and evidence

From repository root, these commands perform no application DB writes:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc -b lib/db lib/api-zod
pnpm --filter @workspace/api-server exec vitest run src/lib/ghl
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/emigration-assist typecheck
pnpm --filter @workspace/emigration-assist build
```

The final focused suite passes all 114 tests across four files, retaining the
original database and delivery regressions. Database tests use fresh **in-memory
PGlite**, verify memory mode before schema writes, never import the
connection-bearing DB entrypoint, and use synthetic `.invalid` identities.
Route tests invoke registered handlers directly with mocked DB/notification
dependencies; they start no HTTP server. HTTP-client, runtime, and setup tests
intercept every transport. No test reads `DATABASE_URL`, uses the application
database, or makes a live GHL call.

Coverage includes atomic commit/rollback, immutable snapshots, deferred
completion, concurrent finalisation, unchanged duplicate 409/validation paths,
frontend HTTP/network/non-confirming-200 retry behaviour, all three delivery
flows, field mapping, rate limits/auth failures, identity conflicts, read-back
failure, expired leases, fencing, lost contact/note/opportunity create responses,
one opportunity link, unknown opportunity refusal, first-touch preservation,
newer-assessment supersession and an actual late mock PUT behind a persisted
scope barrier. This is not a browser UI or live GHL end-to-end test.

Generate the explicit setup plan locally:

```sh
pnpm --filter @workspace/api-server exec esbuild scripts/ghl-setup.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/ema-ghl-setup.mjs
node /tmp/ema-ghl-setup.mjs --dry-run
```

No arguments, `--dry-run`, and its `--plan` alias are network-free defaults that
list the exact 22 proposed request bodies and logical mapping identifiers
without reading environment or credentials. Setup is no longer unconditionally
blocked, but apply requires all of these explicit safeguards:

* `--apply --location-id ID --approve-location ID`;
* `NODE_ENV=development|test` and `EMA_GHL_SETUP_ENABLED=true`;
* the same `ID` in both CLI arguments, `GHL_LOCATION_ID`, and
  `EMA_GHL_TEST_LOCATION_ID`;
* `GHL_PRIVATE_INTEGRATION_TOKEN`;
* explicit `--reuse model.logical_key=FIELD_ID` for any compatible name/key
  collision.

Apply first reads both contact and opportunity fields, validates a complete
collision/reuse plan before the first POST, never updates or deletes fields, and
will not reuse any of the eight protected existing field IDs. It writes only
missing proposed fields, reports each created mapping immediately, refuses
redirects, uses a fixed test-location URL, and never blindly retries an
ambiguous create. `--execute` remains invalid. These apply paths were verified
only with intercepted HTTP; no setup command was run against GHL.

## Remaining decisions and limitations

* Obtain explicit permission for a real end-to-end run in a dedicated GHL test
  location, then verify the 22-field setup/mapping and provider field/response
  contracts and limits there.
* Review duplicate-contact settings, automations, consent/DND and re-entry
  behaviour separately; field and pipeline reads do not establish them.
* Select and verify the test pipeline/stage, automation isolation, and contact
  and opportunity duplicate rules. Approve existing-opportunity ownership and
  decide how future separate cases for the same person fit current intake rules.
* Approve a manual ambiguous-PUT recovery process and any multipart history
  design. Current safe outcome is blocked review, not unattended availability.
* The real client and startup lifecycle exist, but no real end-to-end result is
  claimed. It still needs explicit permission, a test location/token, field
  setup and mapping, pipeline/stage selection, isolated automations, and reviewed
  duplicate rules.
* AWS topology, production secret injection, migration ownership, and production
  worker behavior remain unverified. Production is denied by both runtime code
  and the development/test-only SQL constraints until a later separately
  reviewed scope changes them. See `ghl-aws-rollout.md`; no AWS action occurred.