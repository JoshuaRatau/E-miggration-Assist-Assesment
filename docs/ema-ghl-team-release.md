# EMA → GHL: team release runbook

This is preparation for the existing GitHub/team deployment process. It does not
push, merge, publish, run production migrations, or enable delivery.
The authorized outcome is new completed assessments retained in EMA and delivered
to GHL. Disabled delivery is an intermediate state, not successful completion.

## Release source and files

Repository: `JoshuaRatau/E-miggration-Assist-Assesment`.
The release commit is the local commit containing this runbook and its tools;
obtain its exact SHA with `git rev-parse HEAD` before team review. Do not substitute
the old compiled archive: it predates the canonical pre-commit verification and
controlled executable. No push/merge is performed by this preparation.

Required integration source:

- `artifacts/api-server/src/lib/ghl/` (capture, delivery, mappings, production
  preflight, controlled harness, immutable snapshots and tests).
- Integration changes in `artifacts/api-server/src/routes/leads.ts`,
  `overstayIntake.ts`, `businessIntake.ts`, and `src/index.ts`.
- `lib/db/src/schema/emaGhl.ts` and its schema export.
- The unchanged `lib/db/drizzle/0001_ema_ghl_outbox.sql` and
  `0002_ema_ghl_production.sql`.
- `scripts/ec2-migrate.mjs`, `scripts/ec2-migration-assertions.mjs`,
  `scripts/ec2-migrate.test.mjs`.
- `artifacts/api-server/scripts/ghl-setup.ts`, `ghl-controlled-live.ts`,
  `ghl-production-check.ts`, and `build-ghl-tools.mjs`.
- `scripts/ema-pm2-ghl.cjs` and its focused test.
- `artifacts/emigration-assist/src/pages/assessment.tsx` and
  `src/lib/finalize-assessment.ts`.
- Existing `vercel.json`, Vite base-path configuration, package manifests and
  lockfile. Preserve unrelated application changes already on the team's branch.

Do NOT use `scripts/ec2-api-release-ops.sh` stage/activate/rollback or the earlier
archive-transfer runbook. No new release directory, directory replacement or
symlink activation is part of this plan. The API remains at
`/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server/dist/index.mjs`,
under the existing `immigration-api` PM2 process and existing Nginx proxy.

## Completed here after the base release

Continued from `14c709f1193912a759d6d355641c1de73dee1607`.
All 22 approved EMA custom fields have now been created and read back from the
live location. All eight protected fields were preserved. No contact, note or
opportunity records were created. **Do not run field setup again.**

Actual deployment evidence files:

| File under `docs/release-evidence/` | Actual contents |
| --- | --- |
| `ghl-field-mapping.json` | Complete validated 22-key logical-to-provider-ID mapping |
| `ghl-field-validation.json` | Full provider field readback, destination and mapping digest |
| `ghl-field-setup.jsonl` | Durable creation journal, including explicit reuse after safe stops |
| `ghl-recipient-review.json` | Accepted recipient evidence and precisely unresolved configuration; NOT approval evidence |
| `ghl-controlled-status.json` | Blocked/not-started status; NOT a successful test report |

Mapping SHA-256 (key-sorted JSON):
`913fd11f6f3b4da1d5c1e7ec402af78b7b60bc3902ac940f3c7a56c0b9f03c75`.
The mapping passes the production helper's exact-key/protected-ID validation.
The blocked status was checked and is correctly rejected by activation validation.
The actual saved mapping and existing pipeline/stage also passed the production
destination validator using authenticated GET requests only; no application
database was accessed.

Real provider responses required two narrow validator corrections: enum options
arrive as `picklistOptions`; the provider key for **EMA WhatsApp Opt-in** is
`contact.ema_whatsapp_optin`. The logical mapping key remains
`contact.ema_whatsapp_opt_in`. No unrelated field-key normalization was added.
Deploy this updated source, not just the earlier base revision.

## Reconciled destination and recipient evidence

Authenticated, read-only provider reconciliation during this preparation:

| Item | Result |
| --- | --- |
| Location | `5ce9hy8I0qH6fFNBo1cF` |
| Existing pipeline | Marketing Pipeline, `gXmKkxDwNOTZnpG6AUgD` |
| Existing initial stage | New Lead, `7115d545-87ab-4f8b-b8f9-69a0a8464d26` |
| Contact custom fields after setup | Eight protected plus 20 EMA fields |
| Opportunity custom fields after setup | Two EMA fields |
| EMA-specific fields | All 22 created; exact model/type/options/key readback passed |
| Production ID mapping | Actual IDs saved in `docs/release-evidence/ghl-field-mapping.json` |

Setup performs inventory before creating anything and stops on collisions unless
the exact compatible field is explicitly approved with `--reuse KEY=ID`.
If setup partially fails, retain its creation journal, review those exact created
IDs and use explicit reuse; do not blindly rerun or recreate fields.
No pipeline/stage, protected field, workflow, integration or account setting is
created, modified or revoked by this preparation.

Accepted recipient evidence: all five workflows inventoried; only the Facebook
workflow is published and its sole trigger is Facebook Lead Form Submitted.
BCC/forwarding addresses are empty and assigned-user forwarding is disabled.
The inspected staff profile has conversation email/SMS notifications disabled.
In-app notifications remain enabled.

The sole remaining non-deployment blocker is the account-side recipient behavior
for the four exact writes: contact creation, contact update, note creation and
opportunity creation. Available code/configuration does not establish an active
Ticket System subscriber or other staff alert for them; it also does not prove
that such handlers are absent. The staff configuration GET returned HTTP 401.
Missing fact: whether any such handler is configured and, if so, whether its
actions/recipients exclude everyone except the controlled identity.

A private integration token is API authorization, not evidence of an event
subscription. The application's Eride Support Hub integration only receives
support-widget requests and is not called by the isolated harness. No
notification, workflow or integration preference was changed.
Do not repeat the complete workflow review or infer that unknown handlers are
confirmed sends. The original supplied controlled identity has been located and
validated in its original attachment; it does not need to be supplied again.

## 1. Review and build off-host through the existing team process

Do not run package installs/builds on EC2. In the team's existing build checkout:

```sh
git rev-parse HEAD
pnpm --filter @workspace/api-server run build
node artifacts/api-server/scripts/build-ghl-tools.mjs
node artifacts/api-server/dist/ema-migrate.mjs --plan
```

Completed migration/controlled regression suites need not be repeated.
Only new field-only, real-response decoder and exact-key-alias regressions were
run for this continuation; API typecheck passed after those changes.

The API build clears dist, so build the GHL tools AFTER it. Use the existing
dependency/runtime packaging process; deploy the tools and their data assets
alongside the API under its existing dist, not an alternative release layout.
PGlite assets are needed for the controlled runner, not production API startup.
The controlled test may run on the secure off-host build/operator machine to
avoid adding its WASM/data assets to EC2; the migration/readiness executables
must be deployed with the API.

New tool outputs: `dist/ema-migrate.mjs`, `dist/migrations/*.sql`,
`dist/ghl-production-check.mjs`, `dist/ghl-controlled-live.mjs`,
`dist/ghl-setup.mjs`, `dist/ema-ghl-outbox.sql`, `dist/pglite.wasm`,
`dist/initdb.wasm`, `dist/pglite.data`.

Retain the previous API/frontend revision through the team's existing rollback
process. The repository contains no verified backend deployment job/command:
the deployment owner must use the team's existing transport/job, not an invented
`git pull`, `scp`, directory swap or new GitHub workflow.

## 2. Deploy API files with capture and delivery disabled

Use the existing approved team deployment to deliver the selected source/build
to the existing paths. Preserve the active production environment and Node
interpreter; `.env` is not automatically loaded and must not be sourced.
Do not enable delivery or invoke a backfill.

The additive migrations must complete before production capture is enabled.
The deployed API can remain in disabled mode during this step. The migration
helper obtains DATABASE_URL privately from the existing verified PM2 child:

```sh
cd /home/ubuntu/E-miggration-Assist-Assesment
/usr/bin/node scripts/ema-pm2-ghl.cjs migrate
```

It verifies the exact two SQL hashes, executes 0001 then 0002 with the migration
ledger under one transaction/advisory lock, runs schema assertions before COMMIT,
and verifies again after COMMIT. Assertion/SQL failure rolls back. An ambiguous
commit outcome or post-commit failure stops the sequence; do not auto-retry.
The six tables, required columns, exact production checks, immutable trigger
and function, and valid unique partial opportunity-owner index are asserted.

AWS backup/PITR destination, retention, restore access and coverage remain
**unverified**. The approved alternative is the fresh-schema additive
transactional approach, not a claim that WAL counters prove recoverability.

After successful migration, restart only the deployed API and verify health:

```sh
pm2 restart immigration-api
curl --fail --silent --show-error http://127.0.0.1:5000/api/healthz
curl --fail --silent --show-error https://api.emigration-assist.com/api/healthz
```

## 3. Resolve the one recipient fact, then finish the controlled test here

Field setup is complete; no field-creation action remains for the deployment
owner. The existing token and original approved identity are available in this
environment. Only recipient coverage is unresolved, as recorded in
`docs/release-evidence/ghl-recipient-review.json`.

No isolated database or live contact test was started. There is therefore no
lost run state and no successful controlled report to transfer. The actual
`ghl-controlled-status.json` is deliberately unsuitable for production activation.
Do not rename it or substitute the field-validation report for a success report.

After the exact recipient fact is established, finish the already-approved test
in this environment, without starting the application or touching its database:

1. Assemble the fixed three-pair manifest in memory from the original supplied
   identity, not fixture contact details. Keep existing controlled-live approvals,
   the reviewed location/pipeline/stage, and the actual saved field mapping.
2. Write truthful, fresh CLI-compatible recipient evidence to
   `docs/release-evidence/ghl-recipient-evidence.json` (not produced yet).
3. Load the existing `ghl-field-mapping.json` as `EMA_GHL_FIELD_IDS_JSON`.
   With the existing isolated controlled environment contract, invoke:

   ```sh
   node artifacts/api-server/dist/ghl-controlled-live.mjs --execute \
     --approve-location 5ce9hy8I0qH6fFNBo1cF \
     --recipient-evidence "$PWD/docs/release-evidence/ghl-recipient-evidence.json" \
     > "$PWD/docs/release-evidence/ghl-controlled-report.json"
   ```

   That success-report filename is reserved for future real execution and does
   not currently exist. Do not run until the recipient gate is met.
4. Retain one process/database handle through fresh collision checks, delivery,
   provider readbacks and no-op replay. Retain the resulting report/IDs/digest.
   A crash or ambiguity is a stop condition, not permission to restart and adopt
   the remote contact. Existing collision checks refuse blind recreation.
5. Verify the genuine success report and recipient evidence with the production
   activation helper before handing them to the owner.

The test must establish one GHL contact, three notes, three opportunities and
18 confirmed operations. It is not the final production form-to-GHL verification.

## 4. Deploy the frontend finalisation fix through the existing Vercel project

Use the existing repository-connected assessment Vercel deployment, not the
marketing project or a new project. Retain:

- `vercel.json` at repository root, root directory `./`;
- build `pnpm --filter @workspace/emigration-assist run build`;
- output `artifacts/emigration-assist/dist/public`;
- `/assessment/` asset/router base and existing marketing rewrite;
- `VITE_API_URL=https://api.emigration-assist.com`.

The existing public destination is
`https://www.emigration-assist.com/assessment/`.
The latest GitHub Production deployment record inspected during preparation
was successful, created by vercel[bot], for source
`5bccb93fe3fe3f04c6e16fdfdd4fc60e85679fa7`, with deployment URL
`https://e-miggration-assist-assesment-api-server-motdsh875.vercel.app`.
This identifies an existing deployment, not proof that the marketing rewrite
currently targets it or that it contains this release. The owner selects the
same established project and this release's approved commit through the team's
normal Vercel workflow; no inferred project ID or publish command is used here.

The frontend now awaits `{finalized:true}` before navigation/Lead pixel,
shows retryable failures, and sends `finalize:false` during the intermediate
individual assessment save. Do not publish an older frontend alongside this API.

## 5. Enable production capture AND delivery

Transfer the non-secret field mapping, successful controlled report and completed
recipient evidence through the team's existing protected deployment mechanism.
Keep the private token only in the existing PM2-managed environment.
Use the exact helper commands below (paths supplied by the owner):

```sh
cd /home/ubuntu/E-miggration-Assist-Assesment
/usr/bin/node scripts/ema-pm2-ghl.cjs enable \
  --mapping "$PWD/docs/release-evidence/ghl-field-mapping.json" \
  --controlled-report "$PWD/docs/release-evidence/ghl-controlled-report.json" \
  --recipient-evidence "$PWD/docs/release-evidence/ghl-recipient-evidence.json"
curl --fail --silent --show-error http://127.0.0.1:5000/api/healthz
curl --fail --silent --show-error https://api.emigration-assist.com/api/healthz
```

The helper preserves the verified process environment, clears controlled/test
variables, supplies the reviewed production destination/mapping and exact
production approvals, checks schema/provider configuration read-only, then
updates only immigration-api through PM2. It enables both capture and delivery.
No historical records are reconstructed or backfilled.

Only the mapping file currently exists at these three activation paths.
The two future files must come from completed evidence and actual successful
execution in step 3. Missing/blocked/incorrect reports must stop activation.

Persist this one application's intended environment using the owner's existing
PM2 persistence process. Do not blindly run `pm2 save` while another developer
has unrelated unsaved process changes. The helper does not perform an all-app
save or change unrelated processes.

## 6. Verify actual new-completion delivery

Only after the isolated test passes and production is enabled, observe the first
genuine, consented NEW assessment completion through the deployed form. This is
normal authorized production delivery, not historical backfill or an extra
synthetic test record. Do not create a fourth synthetic contact/opportunity or
override duplicate protection to manufacture proof. If an immediate synthetic
browser test is desired instead, the three-record isolated approval does not
authorize additional records; resolve that scope before creating more.

For the permitted new completion verify, by its exact EMA lead/submission ID:

1. EMA retains the assessment and immutable completed submission.
2. All six production outbox operations reach confirmed, not retry/review/blocked.
3. Stored GHL contact/opportunity IDs match the actual provider records.
4. Mapped values, reference, dated history, Marketing/New Lead destination and
   consent/DND are correct.
5. Re-finalization/retry creates no extra contact, opportunity or history note.
6. No unexpected recipient/workflow side effect occurs.

HTTP health, enabled flags and mocked tests alone are not success evidence.
Do not claim live completion until the real flow and provider state pass.

## Failure handling

For failed startup preflight, delivery errors, unexpected recipients or a failed
end-to-end check, disable both paths using the same targeted configuration helper:

```sh
cd /home/ubuntu/E-miggration-Assist-Assesment
/usr/bin/node scripts/ema-pm2-ghl.cjs disable
```

Retain EMA data, outbox state, mutation barriers, provider IDs and diagnostic
evidence. Never blindly replay an ambiguous remote write.
Use the team's existing API/frontend rollback process for the selected prior
revision; do not invoke the superseded symlink-based script.
Leave additive DB schema intact; restoring a database can discard later writes
and is not an automatic application rollback.