# EMA direct-API integration: development implementation

## Safety and status

This implementation is development-only and mock-only. It does not enable GHL
delivery to the configured account. No application-database migration, live GHL
write, historical replay, AWS change, push, or deployment was performed.

* `captureEnabled()` defaults to false. With capture disabled the routes use
  their original save path and never query the new tables.
* Optional capture requires `NODE_ENV != production`,
  `EMA_GHL_CAPTURE_ENABLED=true`, and `EMA_GHL_TEST_LOCATION_ID`.
  These variables were **not** set on the project. Only test-process variables
  are temporarily stubbed and restored by tests.
* `GHL_PRIVATE_INTEGRATION_TOKEN` is never read by the new implementation.
* `liveGhlClient()` unconditionally throws `LIVE_GHL_WRITES_DISABLED`.
  There is no network-capable client or credential-driven override.
* The worker requires an explicitly supplied in-process `MockGhlClient` and
  `GhlConfig`. It is not registered in server startup. No new timer runs against
  the application database.
* Pipeline, stage and custom-field IDs must be supplied explicitly through
  `GhlConfig`. No production IDs are embedded or selected automatically.
* SQL environment checks accept development/test only. Production requires a
  separate reviewed release; changing an environment switch cannot enable it.

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
scope barrier is persisted **before** each mock POST/PUT. Explicit success or
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

The 47 focused tests pass. They use fresh **in-memory PGlite**, verify memory
mode before schema writes, never import the connection-bearing DB entrypoint,
and use synthetic `.invalid` identities. Route tests invoke registered handlers
directly with mocked DB/notification dependencies; they start no HTTP server.
No test reads `DATABASE_URL` or uses the application database.

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
node /tmp/ema-ghl-setup.mjs --plan
```

The output lists exact proposed request bodies and logical mapping identifiers.
`--apply`, `--execute` or any other non-plan/help argument fails with exit 1 and
`LIVE_GHL_WRITES_DISABLED`. Both apply/execute refusals were verified. The script
has no network or credential access.

## Remaining decisions and limitations

* Approve exact field semantics/options and verify provider field/response
  contracts, limits and original-attribution ownership in a dedicated test
  location before building/enabling a real transport.
* Review duplicate-contact settings, automations, consent/DND and re-entry
  behaviour separately; field/pipeline reads do not establish them.
* Approve pipeline/stage and existing-opportunity ownership policy. Decide how
  future separate cases for the same person fit current duplicate-intake rules.
* Approve a manual ambiguous-PUT recovery process and any multipart history
  design. Current safe outcome is blocked review, not unattended availability.
* Production runtime, secret injection, migration ownership and worker lifecycle
  are still unverified. See `ghl-aws-rollout.md`; no AWS action occurred here.
* Runtime delivery is intentionally not wired up and production is forbidden.
  Future isolated GHL end-to-end testing needs separate explicit approval,
  a test location/token, reviewed automations and a reviewed network adapter.