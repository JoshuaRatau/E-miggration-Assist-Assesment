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

## Reconciled destination and recipient evidence

Authenticated, read-only provider reconciliation during this preparation:

| Item | Result |
| --- | --- |
| Location | `5ce9hy8I0qH6fFNBo1cF` |
| Existing pipeline | Marketing Pipeline, `gXmKkxDwNOTZnpG6AUgD` |
| Existing initial stage | New Lead, `7115d545-87ab-4f8b-b8f9-69a0a8464d26` |
| Existing contact custom fields | Eight protected fields; leave unchanged |
| Existing opportunity custom fields | None |
| EMA-specific fields | All 22 still require the already-approved setup |
| Production ID mapping | Must use the actual IDs returned by setup; not invented IDs |

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

The precise remaining scope is other staff notification settings and Ticket
System's event subscriptions/downstream recipients for contact/opportunity
writes. Do not repeat the five-workflow review or the four drafts. Do not mark
these remaining paths safe without evidence, and do not modify them to make
the test pass. The controlled approval permits only the supplied shared identity
and the three fixed synthetic pairs; consent/DND protections remain mandatory.

## 1. Review and build off-host through the existing team process

Do not run package installs/builds on EC2. In the team's existing build checkout:

```sh
git rev-parse HEAD
node scripts/ec2-migrate.test.mjs
pnpm --filter @workspace/api-server run build
node artifacts/api-server/scripts/build-ghl-tools.mjs
EMA_GHL_TEST_COMPILED=true pnpm --filter @workspace/api-server exec vitest run src/lib/ghl/controlled-cli.test.ts
node artifacts/api-server/dist/ema-migrate.mjs --plan
node artifacts/api-server/dist/ghl-controlled-live.mjs --dry-run
```

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

## 3. Complete setup and the isolated controlled test

Run this on the secure owner/build machine containing the compiled tools and
existing private integration token in its protected process environment. Do not
copy a token into the runbook or shell history. Do not run ordinary application
startup, forms, campaign jobs, or shared-database code for this isolated test.

Use the already supplied controlled email/phone identity; it belongs only in
`EMA_GHL_CONTROLLED_MANIFEST_JSON` through the owner's existing secure input
mechanism. The fixed three lead/submission UUID pairs are printed by the inert
`--dry-run` command and remain unchanged.

Use a subshell so controlled configuration cannot leak into production:

```sh
(
set -eu
umask 077
export NODE_ENV=test
export GHL_LOCATION_ID=5ce9hy8I0qH6fFNBo1cF
export EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID="$GHL_LOCATION_ID"
export EMA_GHL_CONTROLLED_LIVE_APPROVAL=ALLOW_THREE_SYNTHETIC_RECORDS_IN_LIVE_ACCOUNT
export EMA_GHL_DELIVERY_MODE=controlled-live
export EMA_GHL_DELIVERY_ENABLED=true
export EMA_GHL_CAPTURE_ENABLED=false
export EMA_GHL_PIPELINE_ID=gXmKkxDwNOTZnpG6AUgD
export EMA_GHL_STAGE_ID=7115d545-87ab-4f8b-b8f9-69a0a8464d26
export EMA_GHL_SETUP_ENABLED=true
export EMA_GHL_CONTROLLED_SETUP_APPROVAL=ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT
: "${GHL_PRIVATE_INTEGRATION_TOKEN:?Load through existing secure environment}"
: "${EMA_GHL_CONTROLLED_MANIFEST_JSON:?Load the existing approved identity manifest securely}"
: "${EMA_GHL_RECIPIENT_EVIDENCE_FILE:?Set the path to the truthful completed recipient evidence}"
: "${EMA_GHL_RELEASE_EVIDENCE_DIR:?Set an existing protected operator evidence directory}"
export EMA_GHL_MAPPING_FILE="$EMA_GHL_RELEASE_EVIDENCE_DIR/field-mapping.json"

node --input-type=module <<'NODE'
import fs from "node:fs";
import { runGhlSetup } from "./artifacts/api-server/dist/ghl-setup.mjs";
import { readEvidence } from "./artifacts/api-server/dist/ghl-controlled-live.mjs";
await readEvidence(process.env.EMA_GHL_RECIPIENT_EVIDENCE_FILE,process.env.GHL_LOCATION_ID);
if (fs.existsSync(process.env.EMA_GHL_MAPPING_FILE)) throw Error("Mapping exists: review/reuse, do not recreate fields");
const journal=fs.openSync(process.env.EMA_GHL_RELEASE_EVIDENCE_DIR+"/field-creation.jsonl","ax",0o600);
try {
  const location=process.env.GHL_LOCATION_ID;
  const result=await runGhlSetup(["--apply","--controlled-live-account","--location-id",location,"--approve-location",location],{
    onCreated: entry=>fs.writeSync(journal,JSON.stringify(entry)+"\n")
  });
  fs.writeFileSync(process.env.EMA_GHL_MAPPING_FILE,JSON.stringify(result.mappings,null,2),{flag:"wx",mode:0o600});
} finally { fs.closeSync(journal); }
NODE

export EMA_GHL_FIELD_IDS_JSON="$(cat "$EMA_GHL_MAPPING_FILE")"
node artifacts/api-server/dist/ghl-controlled-live.mjs --execute \
  --approve-location "$GHL_LOCATION_ID" \
  --recipient-evidence "$EMA_GHL_RECIPIENT_EVIDENCE_FILE" \
  > "$EMA_GHL_RELEASE_EVIDENCE_DIR/controlled-report.json"
)
```

Only run the setup block once its recipient prerequisites are satisfied.
The evidence template is printed by `--dry-run`; populate only facts genuinely
verified. A current review timestamp is not permission to invent missing
evidence. The test repeats collision lookups immediately before writes.
The CLI retains all fixtures and delivery/replay state in one isolated in-memory
PGlite session; it does not retain synthetic records in the production EMA DB.
It verifies provider state and outputs counts, IDs and mapping evidence without
the controlled email/phone. This test is NOT proof of production form-to-GHL flow.

On failure stop: preserve journals/report, do not enable normal delivery, delete
remote records or rerun a fresh isolated test against its now-existing contact.
The collision guard intentionally refuses adoption of a prior run's records.

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
  --mapping "$EMA_GHL_MAPPING_FILE" \
  --controlled-report "$EMA_GHL_CONTROLLED_REPORT_FILE" \
  --recipient-evidence "$EMA_GHL_RECIPIENT_EVIDENCE_FILE"
curl --fail --silent --show-error http://127.0.0.1:5000/api/healthz
curl --fail --silent --show-error https://api.emigration-assist.com/api/healthz
```

The helper preserves the verified process environment, clears controlled/test
variables, supplies the reviewed production destination/mapping and exact
production approvals, checks schema/provider configuration read-only, then
updates only immigration-api through PM2. It enables both capture and delivery.
No historical records are reconstructed or backfilled.

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