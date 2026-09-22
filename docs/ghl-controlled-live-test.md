# Controlled test in the LIVE E-Migration Assist GHL sub-account

## Latest execution result — 2026-09-22

The recipient gate is closed with the owner's explicit Ticket System
non-reachability confirmation, recorded as owner-supplied evidence rather than
independent technical verification. Earlier unresolved-recipient and
not-started statements below are historical and superseded by this section.
Do not repeat the completed review or field setup.

One approved isolated run created contact `DbmJnLc7qWqwQek67U2n`, then stopped
at contact verification. Actual readback: one contact, zero notes, zero
opportunities. The approved identity and checked individual mapped values match.
GHL returns firstName/lastName but no name property; the verifier's direct
comparison of the submitted name therefore fails. No replay was reached.

The process ended; the in-memory run is not recoverable. No automatic restart,
contact adoption, cleanup or extra write was attempted. Preserve the transport
journal, partial readback and stopped status under `docs/release-evidence/`.
No success report exists and activation remains blocked. See the current
handoff at the top of `ema-ghl-team-release.md`; the procedure below is not an
instruction to restart this stopped run.

**Current execution status:** all 22 approved field definitions are now created
and validated. See `release-evidence/ghl-field-mapping.json` and
`ema-ghl-team-release.md`; do not create them again. No controlled contact,
note or opportunity test was started: account-side recipient configuration
remains unresolved. The original supplied identity is available, not missing.
The proposed field-creation procedure below is historical scope, not work to rerun.

## Status and permission boundary

The user approved the exact bounded live-write scope on 2026-09-21, explicitly
retaining all recipient and safety gates. Execution has not started; this is not
an end-to-end success report. Account-side recipient verification remains pending.
The GHL destination is a LIVE sub-account, not a separate test account. Replit is
development; AWS hosts production. No live setup/delivery flags were enabled.
No application database migration, AWS change, push or deployment was performed.

On 2026-09-21 the user authorised test email, SMS and WhatsApp messages **only to
the supplied controlled email/phone pair**, and only for the three assessments
below. This is recipient-specific messaging permission, **not live-write approval**.
It does not authorise other recipients, consent/DND overrides, or workflow/account
changes. Preserve existing suppression/DND; do not enable normal app notification
paths or send extra diagnostic messages merely because receipt is permitted.

The user supplied duplicate settings: duplicates OFF, email primary, phone
secondary. The attached duplicate-settings screenshot supports these settings.
The user also reports a published Facebook-lead-triggered workflow and four draft
workflows. The user subsequently confirmed this is the complete five-workflow
inventory; do not request that inventory again. Remaining recipient evidence is
other staff notification coverage and Ticket System's relevant subscriptions/
downstream recipients, as reconciled in `ema-ghl-team-release.md`.

## Read-only configuration evidence

The following authenticated GET requests returned HTTP 200 with Version v3:

- Contact field definitions: the same eight protected TEXT fields.
- Opportunity field definitions: none.
- Pipelines: Marketing Pipeline, with New Lead, Contacted, Qualified, Proposal
  Sent, Negotiation and Closed.

Proposed destination for the three new opportunities:

- Pipeline: Marketing Pipeline, `gXmKkxDwNOTZnpG6AUgD`.
- Initial stage: New Lead, `7115d545-87ab-4f8b-b8f9-69a0a8464d26`.
- Status: open; no monetary value, qualification, booking or won/lost rules.
- One opportunity per explicitly allowlisted EMA lead.

The user has supplied one controlled email/phone pair for all three assessments.
Do not copy the user's personal contact details into source, fixtures or this
document. Separate read-only email and phone requests on 2026-09-21 each returned
HTTP 200 with no matching contact. This is point-in-time evidence only; repeat
both checks immediately before any approved writes. A supplied identity is not
permission to adopt or modify an existing contact. The later recipient-specific
messaging permission above is the only messaging authorisation for this test.

## Exact proposed live changes

Approved scope, subject to fresh inventory/collision checks and verification that
reachable GHL automations cannot send to other recipients:

1. Create the 22 fields below. Reuse **zero** existing fields.
2. If both identity searches find no contact, create exactly one new synthetic
   contact shared by the individual, overstay and business harness assessments.
3. Create three dated assessment-history notes on that shared contact.
4. Create one linked open New Lead opportunity per allowlisted EMA lead.
5. Retry/replay only those records; no additional records, existing-contact
   adoption, historical backfill, account/workflow edits or cleanup deletion.

The contact is created for the individual assessment, then updated for overstay
and business in that order. These two updates apply only to the newly created,
run-owned contact, not any pre-existing contact. Readbacks and replay must preserve
one contact, three dated notes and three distinct opportunities.

### Fixed proposed allowlist and synthetic answers

These are reserved identifiers, not records already created in any database:

| Flow / processing order | EMA lead UUID | Submission UUID |
|---|---|---|
| 1. individual | 843b5cf4-456c-46cd-87e5-50f6d9cc1a4f | 2a2f7b63-f30c-4f20-8ceb-4662ff024dcd |
| 2. overstay | 856c18fe-962a-45e2-b457-88ab2f4a20cb | f0cf5621-8084-4088-9830-4a0f763a0128 |
| 3. business | 7eb4be34-7b67-4c28-8dd7-df02cef5fd1a | 6289f8e1-adbc-49a3-844b-50ea6fd98b40 |

At execution, assemble the manifest in memory using these identifiers, the
already validated configured live location, and the same supplied normalised
email and international phone for every row. Do not persist the user's contact
details in repository files or invent another identity.

All three synthetic snapshots use `fullName: EMA Controlled Test`,
`consentAccepted: true`, `preferredContactMethod: email`, the supplied contact
pair in email/phone/whatsapp, and a runtime UTC consent timestamp. This is test-only
assessment consent, not a DND override or general marketing subscription.
Leave `whatsappOptIn` absent rather than treating bounded test-message permission
as a permanent marketing opt-in. Attribution uses `source: controlled-test`,
`sourceCampaign: shared-contact-test`; references are generated as
`EMA-CONTROLLED-TEST-<flow>`.

Flow-specific synthetic answers:
- Individual: `immigrationSituation: visa_required`.
- Overstay: `firstName: EMA Controlled Test`, `currentSituation: unsure_of_status`.
- Business: `firmName: EMA Controlled Test Firm`, `practiceAreas: [work_visas]`,
  `casesLast12mBand: <25`.

These are deliberately minimal integration fixtures, not statements about the
user's actual immigration/business situation or validated full form answers.
Complete individual first, then overstay, then business, so business is the
latest completed assessment. Check common latest-submission/type/timestamp values
and supplied business values, while preserving the earlier full snapshots/notes
and first-touch attribution. Flow-specific fields absent from a later assessment
are not automatically cleared by the existing mapper.

The eight existing fields remain untouched: Work Email, Biggest Challenge,
Visa Services Managed, Job Title, Work Phone Number, Monthly Case Volume,
Organization Type and Solution Timeline. Matching names do not establish matching
business purposes. Existing fields are not repurposed.

### Proposed field definitions

Logical keys are configuration identifiers, not existing provider IDs.

| Model | Display name | Logical key | Type / options |
|---|---|---|---|
| contact | EMA Lead ID | ema_lead_id | TEXT |
| contact | EMA Reference | ema_reference | TEXT |
| contact | EMA Latest Submission ID | ema_latest_submission_id | TEXT |
| contact | EMA Assessment Type | ema_assessment_type | SINGLE_OPTIONS: individual, overstay, business |
| contact | EMA Latest Completed At | ema_latest_completed_at | TEXT: ISO-8601 UTC |
| contact | EMA Assessment Consent | ema_assessment_consent | SINGLE_OPTIONS: accepted, not-recorded |
| contact | EMA Consent At | ema_consent_at | TEXT: ISO-8601 UTC |
| contact | EMA Preferred Contact Channel | ema_preferred_contact_channel | SINGLE_OPTIONS: email, whatsapp, phone |
| contact | EMA WhatsApp Number | ema_whatsapp_number | TEXT |
| contact | EMA WhatsApp Opt-in | ema_whatsapp_opt_in | SINGLE_OPTIONS: yes, no, not-recorded |
| contact | EMA Source | ema_source | TEXT |
| contact | EMA Source Campaign | ema_source_campaign | TEXT |
| contact | EMA UTM Source | ema_utm_source | TEXT |
| contact | EMA UTM Medium | ema_utm_medium | TEXT |
| contact | EMA UTM Campaign | ema_utm_campaign | TEXT |
| contact | EMA Funnel Context | ema_funnel_context | LARGE_TEXT: captured JSON |
| contact | EMA Immigration Situation | ema_immigration_situation | SINGLE_OPTIONS: valid, expired, overstay, undesirable, prohibited, visa_required, unknown |
| contact | EMA Overstay Situation | ema_overstay_situation | SINGLE_OPTIONS: visa_expired, undesirable_declaration, overstayed_after_expiry, unsure_of_status, application_rejected_in_sa, missed_departure_deadline, other |
| contact | EMA Practice Areas | ema_practice_areas | MULTIPLE_OPTIONS: work_visas, permanent_residence, appeals, condonation, corporate_mobility, other |
| contact | EMA Annual Case Volume Band | ema_annual_case_volume_band | SINGLE_OPTIONS: <25, 25-99, 100-249, 250+ |
| opportunity | EMA Lead ID | ema_lead_id | TEXT |
| opportunity | EMA Reference | ema_reference | TEXT |

Standard names/email/phone/company are mapped only from approved synthetic
answers. Full answers and captured consent/attribution remain in immutable EMA
snapshots and dated notes. First-touch attribution remains separate from latest
assessment values. No DND, subscription or suppression settings are cleared.

## Controlled-mode gates

Controlled mode explicitly identifies a live account. It requires:

- `EMA_GHL_DELIVERY_MODE=controlled-live`.
- Existing `GHL_LOCATION_ID`, matching `EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID`.
- `EMA_GHL_CONTROLLED_LIVE_APPROVAL=ALLOW_THREE_SYNTHETIC_RECORDS_IN_LIVE_ACCOUNT`.
- `EMA_GHL_CONTROLLED_MANIFEST_JSON`: exactly three unique EMA lead/submission
  UUID pairs, one per flow, all with the identical normalized user-controlled
  email and E.164 phone. Mixed identities are rejected in this bounded mode.
- Existing delivery enablement, approved pipeline/stage and returned field IDs.
- An isolated controlled-database handle, not the application database loader.

Setup is independently disabled by default. Future controlled setup requires
`--controlled-live-account` plus the existing explicit apply/location gates and
`EMA_GHL_CONTROLLED_SETUP_APPROVAL=ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT`.
These are descriptions of safeguards, not instructions to enable them now.

Two separate lookups (email first, phone second) must establish no match before writes. The
in-process preflight receipt binds to the destination and exact manifest, expires
after 30 minutes and becomes invalid if the manifest changes. A match, ambiguous
response or email/phone conflict blocks preparation. Both searches are performed
so different matching contacts can be reported as an identity conflict.

The first assessment creates the shared contact. Later assessments may use only
that contact's persisted run-owned link, with the remote manifest markers and
email/phone reverified. A matching contact appearing after preflight is not adopted,
even if it has similarly named EMA fields. Ambiguous creation may only reconcile
the current recorded create attempt with the exact expected submission markers.

All six operations of the oldest completed submission must be confirmed before
the next submission advances. Controlled completion timestamps are monotonically
ordered at millisecond precision and are immutable after completion. The last
completed assessment controls latest-answer fields; all three histories remain.
First-touch attribution and unrelated/DND fields are preserved.

## Database isolation: verified and limited

The controlled harness constructs a fresh embedded **in-memory PGlite** instance.
It has no network database URL and cannot connect to the application or AWS
database. Memory mode is asserted before its schema/migration is applied.
This proves isolation by construction without accessing either real database.

The harness uses a minimal fixture lead table and the actual transactional
snapshot/completion functions. It verifies individual deferred finalisation and
atomic overstay/business completion; it is **not** a persistent standalone EMA
deployment or a full HTTP/form end-to-end environment.

`createControlledRun(config)` retains the same database/run handle throughout
save, finalisation, delivery and replay. Its normal `close()` rejects until
`verifyReplay(worker)` confirms 18 operations, three run links, one shared
contact ID, three distinct opportunity IDs and an unchanged no-op replay.
There is no automatic close between assessments or delivery/replay.

Restart loses the isolated records, remote links and preflight receipt. A later
new session must not adopt existing test contacts automatically; collisions
require review. A persistent full-application isolated database has not been
provisioned or verified. Full HTTP/form E2E remains blocked on that environment
and provider-isolation work if that broader test is required.

### Actual EMA duplicate rules and expected counts

All three production intake routes retain their email-OR-canonical-WhatsApp
duplicate checks and `409 already_registered` behaviour. Three submissions using
the same pair cannot produce three new leads through the ordinary forms: after
the first accepted lead, the other two submissions are rejected.

The integration harness deliberately seeds three explicitly approved synthetic
lead fixtures into its isolated minimal table; it is not pretending those records
passed production intake validation. Expected harness counts are **3 EMA leads,
3 immutable submissions, 1 GHL contact, 3 dated notes and 3 opportunities**.
The three opportunities follow the existing one-opportunity-per-EMA-lead policy.
An ordinary browser test using this one identity can produce at most **1 accepted
EMA lead, 1 completed submission, 1 contact, 1 history note and 1 opportunity**
from these three attempts (subject to finalisation and collision approval).
No duplicate-handling or production validation bypass is included.

## Proposed test procedure (not executed live)

1. Use the fixed allowlist and synthetic answers above with the user's supplied
   normalized email/E.164-phone pair; do not invent or store other contact details.
2. Bind those three lead/submission pairs and the destination into an in-memory manifest.
3. Establish that reachable GHL automations cannot send to other recipients.
   Permission covers the supplied test identity only; if staff/external recipients
   cannot be excluded, stop and request clarification, not wider permission by assumption.
4. Repeat read-only inventory and the two identity-collision checks; stop on matches.
5. Retain the already-received bounded approval for exactly the fields and records
   above. Do not request that same approval again; unresolved recipient and
   pre-write checks still block execution.
6. Once those remaining gates pass, create and retain one controlled run handle; never use the
   ordinary app server, frontend, startup jobs or application database. Retain
   that same handle until delivery and no-op replay both finish.
7. Save individual answers; verify immutable snapshot and no queued delivery
   before finalisation. Finalise and verify the six-operation queue.
8. Save overstay/business and verify atomic lead/snapshot/queue completion.
9. Execute approved setup, record field mappings, then process only the manifest.
10. Read back contact values, captured attribution, dated complete notes and
    opportunity links. Confirm no records outside the manifest were touched.
11. Replay finalisation and delivery; verify the same one contact, three notes and
    three opportunities remain, together with all local links. Call
    `verifyReplay(worker)` before closing the handle. Inject retry/timeout cases with intercepted transport,
    not deliberate uncontrolled failures in the live account.
12. Reconcile any ambiguous live outcome read-only; stop rather than blindly retry
    or remove a mutation barrier. Report observed provider sends separately.

## Notification risks and stop conditions

Bounded test messages to the supplied email/phone are permitted. The ordinary
frontend/server is still excluded from this harness; the following paths exist:

- Individual OTP request can invoke Twilio WhatsApp or email, including fallback.
  A development OTP code does not inherently suppress the provider call.
- All three completion routes can invoke confirmation email/WhatsApp.
- Normal server startup also starts unrelated campaign/Meta/scoring workers.
- Browser flows can emit Meta analytics events.

The isolated snapshot harness avoids those paths entirely. Existing route tests
mock notification dependencies; they do not establish no-send behaviour of the
ordinary deployed forms.

Known routes to recipients other than this controlled identity:
- Referral internal notification: `src/routes/referrals.ts` calls
  `sendInternalNotification`; its team inbox is not covered by this permission.
- Support-widget internal notification: `src/routes/support.ts` calls
  `sendInternalNotification`; its team inbox is likewise not authorised.
- Normal app campaign/scheduled-send workers can contact unrelated leads; admin
  manual email and admin-auth routes can send to their selected recipients.

These are known application paths, not claims that GHL writes trigger them. The
standalone harness imports snapshot/delivery components rather than the normal
server and does not invoke those paths. Do not start/restart the normal server,
use browser forms, invoke referral/support/admin routes, or run campaign workers
as part of this controlled test. Existing unrelated services are not changed.

GHL contact/field/note/opportunity writes can trigger account-side automations.
The reported Facebook-specific workflow and four drafts do not rule out other
workflows, legacy campaigns, opportunity notifications or integration actions.
No account settings/automations were changed, and this code does not claim a
provider-wide recipient allowlist for GHL automations. Staff/assigned-user emails,
internal workflow notifications, webhooks or forwarded messages are possible but
not verified active paths in this GHL account. Do not present them as confirmed
sends. Account-side recipient scope remains unverified; user permission does not
cover them. If other recipients cannot be excluded, live execution remains paused
even after bounded scope approval. Do not solve this by changing workflows/settings.

## Evidence and outstanding inputs

Isolated/intercepted tests are evidence about code, not live GHL delivery.
See `docs/ghl-development.md` for the core regression suite and
`src/lib/ghl/controlled.test.ts` for controlled-mode coverage.

Prepared: fixed three-pair allowlist, synthetic answers, shared-contact procedure,
and recipient-specific permission boundary. Prior isolated/intercepted verification
passed 128 tests plus API typecheck/build; this documentation-only update does not
claim another test run. Separate email/phone checks returned no matches as recorded
above; refresh immediately before approved writes.

Bounded live-write approval received for the exact fields, records, sequential
contact updates and replay described above, retaining all recipient/safety gates.
Pending: evidence that reachable GHL automations cannot send to other recipients,
then immediate pre-write inventory/collision checks. Approval of the listed records
does not waive recipient restrictions. Live writes remain disabled until those
gates pass. No live E2E success is claimed.