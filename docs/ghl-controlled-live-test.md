# Controlled test in the LIVE E-Migration Assist GHL sub-account

## Status and permission boundary

This is preparation, not a test-execution approval or an end-to-end success report.
The GHL destination is a LIVE sub-account, not a separate test account. Replit is
development; AWS hosts production. No live setup/delivery flags were enabled.
No application database migration, AWS change, push or deployment was performed.

The user supplied duplicate settings: duplicates OFF, email primary, phone
secondary. The attached duplicate-settings screenshot supports these settings.
The user also reports a published Facebook-lead-triggered workflow and four draft
workflows. That is not a verified inventory of every outbound automation.

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

No contact collision searches were performed: the three user-controlled test
identities have not been supplied. No contacts or other personal records were
retrieved during this preparation.

## Exact proposed live changes

Subject to fresh inventory/collision checks and a single later bounded approval:

1. Create the 22 fields below. Reuse **zero** existing fields.
2. Create exactly three new synthetic contacts: individual, overstay, business.
3. Create one dated assessment-history note on each of those contacts.
4. Create one linked open New Lead opportunity per allowlisted EMA lead.
5. Retry/replay only those records; no additional records, existing-contact
   adoption, historical backfill, account/workflow edits or cleanup deletion.

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
  UUID pairs, one per flow, with unique user-controlled emails and E.164 phones.
- Existing delivery enablement, approved pipeline/stage and returned field IDs.
- An isolated controlled-database handle, not the application database loader.

Setup is independently disabled by default. Future controlled setup requires
`--controlled-live-account` plus the existing explicit apply/location gates and
`EMA_GHL_CONTROLLED_SETUP_APPROVAL=ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT`.
These are descriptions of safeguards, not instructions to enable them now.

All six email/phone lookups must establish no match before writes. The
in-process preflight receipt binds to the destination and exact manifest, expires
after 30 minutes and becomes invalid if the manifest changes. A match, ambiguous
response or email/phone conflict blocks the affected preparation.

## Database isolation: verified and limited

The controlled harness constructs a fresh embedded **in-memory PGlite** instance.
It has no network database URL and cannot connect to the application or AWS
database. Memory mode is asserted before its schema/migration is applied.
This proves isolation by construction without accessing either real database.

The harness uses a minimal fixture lead table and the actual transactional
snapshot/completion functions. It verifies individual deferred finalisation and
atomic overstay/business completion; it is **not** a persistent standalone EMA
deployment or a full HTTP/form end-to-end environment.

Restart loses the isolated records, remote links and preflight receipt. A later
new session must not adopt existing test contacts automatically; collisions
require review. A persistent full-application isolated database has not been
provisioned or verified. Full HTTP/form E2E remains blocked on that environment
and provider-isolation work if that broader test is required.

## Proposed test procedure (not executed live)

1. Obtain three unique email/phone pairs controlled by the user, synthetic
   assessment details and explicit ownership confirmation.
2. Bind the three lead/submission UUID pairs and destination into the manifest.
3. Inspect all outbound automation paths with an account owner. Resolve the
   notification blocker below before live execution approval.
4. Repeat read-only inventory and six identity-collision checks; stop on matches.
5. Present one consolidated approval covering exactly the fields and records
   above, the manifest, destination, pipeline and unresolved risks.
6. Only after approval, use a single isolated harness session; never the ordinary
   app server, frontend, startup jobs or application database.
7. Save individual answers; verify immutable snapshot and no queued delivery
   before finalisation. Finalise and verify the six-operation queue.
8. Save overstay/business and verify atomic lead/snapshot/queue completion.
9. Execute approved setup, record field mappings, then process only the manifest.
10. Read back contact values, captured attribution, dated complete notes and
    opportunity links. Confirm no records outside the manifest were touched.
11. Replay finalisation and delivery; verify the same three contacts, notes and
    opportunities remain. Inject retry/timeout cases with intercepted transport,
    not deliberate uncontrolled failures in the live account.
12. Reconcile any ambiguous live outcome read-only; stop rather than blindly retry
    or remove a mutation barrier. Report observed provider sends separately.

## Notification risks and stop conditions

Normal EMA frontend submissions are not a safe no-notification test route:

- Individual OTP request can invoke Twilio WhatsApp or email, including fallback.
  A development OTP code does not inherently suppress the provider call.
- All three completion routes can invoke confirmation email/WhatsApp.
- Normal server startup also starts unrelated campaign/Meta/scoring workers.
- Browser flows can emit Meta analytics events.

The isolated snapshot harness avoids those paths entirely. Existing route tests
mock notification dependencies; they do not establish no-send behaviour of the
ordinary deployed forms.

GHL contact/field/note/opportunity writes can trigger account-side automations.
The reported Facebook-specific workflow and four drafts do not rule out other
workflows, legacy campaigns, opportunity notifications or integration actions.
No account settings/automations were changed, and this code does not claim a
provider-wide no-send switch. Zero unintended sends cannot yet be guaranteed.

## Evidence and outstanding inputs

Isolated/intercepted tests are evidence about code, not live GHL delivery.
See `docs/ghl-development.md` for the core regression suite and
`src/lib/ghl/controlled.test.ts` for controlled-mode coverage.

Pending: three owned contact pairs, exact synthetic answers/manifest,
no-collision checks, account-side notification review and one final bounded
approval. No live E2E success is claimed.