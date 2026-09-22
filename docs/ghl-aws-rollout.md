# GHL integration: AWS deployment and rollout gates

> **OBSOLETE HISTORICAL DESIGN — NOT EXECUTABLE RELEASE INSTRUCTIONS.**
> The single authoritative current handoff is
> [EMA → GHL deployment-owner runbook](ema-ghl-team-release.md).
> It supersedes every gate, record-model assumption and deployment instruction
> below. The approved model is one person → one contact → one case, not one
> opportunity per assessment. AWS execution is human-only; Replit does not call
> AWS/SSM or request IAM access. The existing controlled test has passed, while
> human production deployment, activation and end-to-end verification remain.
> Retain the text below only as historical design context; do not execute it.

> **Status: future runbook, not a deployment record.** The approved work is
> development-only. Replit remains the development environment and AWS is the
> intended production environment, but this repository does not establish that
> an AWS production service is currently live. Nothing in this runbook
> authorizes a GHL write, an AWS change, a database migration, a historical
> backfill, or a deployment.

## Scope and verified repository facts

This runbook covers only the future deployment/configuration of the revised
direct GHL integration for the three audited assessment flows: individual,
overstay, and business. The implementation must preserve the existing forms,
validation, duplicate responses, CRM behavior, consent/DND state, assessment
history, original attribution, and the eight existing GHL custom fields.

The following facts were verified in the repository while preparing this
document:

- `artifacts/api-server/package.json` starts the built API with
  `node --enable-source-maps ./dist/index.mjs`.
- `artifacts/api-server/src/index.ts` starts the HTTP server and the score,
  pg-boss campaign, campaign-schedule, and Meta sync workers in the same
  process. The current worker design is therefore coupled to API replica count.
- The API requires `PORT`; application configuration and credentials are read
  from `process.env`. The database and pg-boss use `DATABASE_URL`.
- `GET /api/healthz` exists as the current process health endpoint.
- `lib/db/package.json` currently exposes schema-push scripts, while the
  checked-in Drizzle history contains only an initial migration. The GHL schema
  change must not be released by running schema push against production.
- No AWS IaC or container deployment definition is checked in.
- `docs/AWS_DEPLOYMENT.md` is a stale Elastic Beanstalk plan and also contains
  old App Runner references and unsafe production schema-push guidance.
  `replit.md` describes a stale Vercel/Replit live topology. Neither document
  is evidence of the current production topology or approval to provision it.

Before using this runbook, the release owner must re-verify those facts against
the release commit. The current implementation contract is documented in
`docs/ghl-development.md`:

- Capture defaults off; development capture requires `EMA_GHL_CAPTURE_ENABLED=true`
  and a separately configured `EMA_GHL_TEST_LOCATION_ID`.
- The additive migrations are `lib/db/drizzle/0001_ema_ghl_outbox.sql`,
  `0002_ema_ghl_production.sql`, and
  `0003_ema_ghl_provider_failure_diagnostics.sql`. The third migration adds
  nullable, strictly constrained provider-failure diagnostics to the operation
  attempt journal. Migration execution remains an explicit reviewed one-off;
  application startup never applies migrations.
- `artifacts/api-server/scripts/ghl-setup.ts` defaults to a network-free dry run
  (`--dry-run`, alias `--plan`). Its real apply mode is restricted to
  development/test and requires `--apply`, matching `--location-id` and
  `--approve-location`, `EMA_GHL_SETUP_ENABLED=true`, matching
  `GHL_LOCATION_ID` and `EMA_GHL_TEST_LOCATION_ID`, and
  `GHL_PRIVATE_INTEGRATION_TOKEN`. `--execute` is invalid.
- `GhlConfig` supplies location, pipeline, stage and model-prefixed field IDs.
  No production mappings are selected.
- A real fixed-host, endpoint-allowlisted GHL v3 HTTP client exists.
  `src/index.ts` starts the delivery runtime after server startup and awaits its
  stop during graceful shutdown. Delivery is independently default-off and the
  disabled path does not access credentials, load/query the database, construct
  a worker, schedule a timer, or require the new tables.
- Enabled delivery requires `EMA_GHL_DELIVERY_ENABLED=true`,
  `EMA_GHL_DELIVERY_APPROVAL=ALLOW_SYNTHETIC_TEST_DELIVERY`,
  `NODE_ENV=development|test`,
  `GHL_LOCATION_ID=EMA_GHL_APPROVED_TEST_LOCATION_ID`, and, if capture's
  `EMA_GHL_TEST_LOCATION_ID` is set, that same value there too. It also requires
  `GHL_PRIVATE_INTEGRATION_TOKEN`, pipeline/stage, and all 22 field IDs.
  Production is excluded by runtime code and by the migration's
  development/test-only environment constraints.

This is therefore not an activation-ready production release. The transport and
worker lifecycle now exist for an explicitly approved synthetic test, but no
live call was made. Production runtime allowance, production schema allowance,
AWS verification, and configuration are future reviewed code/release gates,
not switches to turn on during this development step.

## Non-negotiable safety boundaries

1. Automated tests use an isolated development/test database and intercepted
   GHL responses. Any later real test-location run requires separate permission.
2. All actual GHL writes default disabled. Credentials alone never enable them.
   Test delivery and test field setup each require their own exact flags,
   approvals, destination equality, and non-production environment gates.
3. No test targets the live GHL location. No live contact, opportunity, custom
   field, pipeline, stage, workflow, or automation may be changed during
   development verification.
4. There is no historical backfill in this rollout. Only leads finalized after
   explicit production enablement may be eligible for delivery.
5. The integration feature remains off until the reviewed additive migration
   has completed and its post-migration checks pass.
6. Do not adopt an ambiguous pre-existing opportunity. Production behavior
   must create or reconcile **one and only one opportunity per EMA lead**.
7. Do not introduce qualification, booking, or won/lost rules.

## Required AWS decisions before configuration

Because the repository has no AWS IaC and live AWS verification is absent, an
account owner and platform owner must first record:

- AWS account, region, VPC/subnets, production database, public API hostname,
  frontend origin, TLS/DNS ownership, and log/alert destination;
- the approved compute service and immutable image/artifact source;
- the approved deployment mechanism and rollback owner;
- whether API replica count will remain one or workers will be separated and
  made safe for multiple replicas;
- the mechanism for running a one-off, versioned migration with production
  application tasks prevented from applying schema changes at startup.

Do not reuse the resource names, sizing, region, or public-RDS steps in
`docs/AWS_DEPLOYMENT.md` without a fresh architecture and security review.
A reasonable future target could be private RDS PostgreSQL plus an
ECS/Fargate-style API service behind HTTPS, but that is a decision to approve,
not a statement of current architecture. Until worker topology is changed,
run exactly one API task; otherwise each replica starts the embedded periodic
workers.

## Prepare the release

### 1. Pin and review the artifact

- Pin one reviewed commit and build one immutable API artifact from it.
- Confirm its production start command resolves to
  `node --enable-source-maps ./dist/index.mjs`.
- Record build/typecheck/test evidence supplied by the implementation owner.
- Cross-check the exact flag, script, migration, queue, and config names in that
  commit. Confirm all GHL write paths and the setup script are off by default.
- Review the three flow mappings, captured UTM source/medium/campaign fields,
  full funnel context, immutable-answer capture, finalization behavior,
  atomicity requirements, retry/lease recovery, conflicts, and reconciliation.

### 2. Review GHL configuration outside production

Use an isolated GHL test location containing synthetic contacts only. Before
any isolated end-to-end test:

- review the proposed field definitions against the eight existing custom
  fields and resolve duplicates by stable GHL field identity, not display name;
- review duplicate-contact settings, opportunity duplicate settings, workflows,
  triggers, automations, assignment rules, notifications, and webhooks that
  could create side effects;
- disable or isolate automations that could message people, mutate unrelated
  records, or create additional opportunities;
- select an unambiguous test pipeline and test stage;
- approve the explicit field setup script in dry-run/plan mode first, then
  separately authorize any test-location-only execution;
- use synthetic email addresses, telephone numbers, names, attribution values,
  and assessment answers.

The test must prove that retries and reconciliation do not duplicate contacts
or opportunities, newer remote values are preserved as designed, consent/DND
is preserved, and each synthetic EMA lead has exactly one opportunity in the
configured pipeline/stage.

### 3. Create a reviewed, additive migration

Do not use `pnpm db:push`, `drizzle-kit push`, or `push-force` in production.
The implementation owner must provide a checked-in, versioned SQL migration
that is additive and reviewable. It must:

- create only the required GHL delivery/link/event/configuration structures and
  indexes;
- avoid destructive renames, drops, table rewrites, and implicit backfills;
- make new nullable/defaulted columns safe for the currently running version;
- preserve existing lead and assessment rows unchanged;
- include an explicit down/forward-fix strategy appropriate to any data already
  written after enablement.

Have the application owner and database owner review the generated SQL and a
query plan/lock-risk assessment. Apply it first to a production-like isolated
database and verify old code continues to operate while the feature is off.

## AWS configuration

### Secrets and identity

Create production values independently in AWS Secrets Manager or the approved
AWS secret store. Do not copy Replit Secrets wholesale, expose values in shell
history, logs, task definitions, source control, tickets, or chat.

For a future production-capable release, classify and provision:

- the production `DATABASE_URL`;
- `GHL_PRIVATE_INTEGRATION_TOKEN`;
- `GHL_LOCATION_ID`;
- `EMA_GHL_PIPELINE_ID` and `EMA_GHL_STAGE_ID`;
- `EMA_GHL_FIELD_IDS_JSON`, containing all 22 model-prefixed mappings;
- `EMA_GHL_DELIVERY_ENABLED`, initially `false`;
- existing API secrets required for unchanged functionality.

The current synthetic-test-only approval controls are
`EMA_GHL_DELIVERY_APPROVAL=ALLOW_SYNTHETIC_TEST_DELIVERY` and
`EMA_GHL_APPROVED_TEST_LOCATION_ID`; they are not production approvals.
`EMA_GHL_CAPTURE_ENABLED` and its `EMA_GHL_TEST_LOCATION_ID` destination are
independent from delivery. The field setup gate is separately
`EMA_GHL_SETUP_ENABLED=true` and is rejected in production. The exact names and
semantics must be re-verified from the future production release commit.
Inject secrets into the runtime process through the compute service's secret
integration. Grant the task role read access only to its named secrets and any
required AWS resources. Prefer task roles for AWS service access rather than
static AWS access keys. Development, test, and production must use separate
secret objects, credentials, databases, and GHL locations.

Non-secret configuration such as `NODE_ENV=production`, `PORT`, `WEB_ORIGIN`,
`CROSS_SITE_COOKIES`, public base URL, log level, and approved storage settings
must also be reviewed against the release commit. Restrict `WEB_ORIGIN` to the
real production browser origins; do not rely on permissive development
fallbacks.

### Network and observability

- Keep the database in private subnets and allow PostgreSQL ingress only from
  the migration runner and API task security groups.
- Allow API egress to the approved GHL endpoint over TLS; avoid unrestricted
  inbound access to tasks.
- Terminate public TLS at the approved load balancer/API edge and route its
  health check to `/api/healthz`.
- Confirm logs redact authorization headers, tokens, and lead PII. Create
  alerts for unhealthy tasks, migration failure, delivery failure/backlog,
  exhausted retries, expired leases, reconciliation conflicts, and abnormal
  opportunity-duplication signals.
- Set deployment health thresholds and rollback alarms before the first
  production release.

## Production rollout checklist

All boxes are manual gates. A checked box must have an owner, timestamp, release
commit, and evidence link in the change record.

### Gate A — authorization and topology

- [ ] Product/data owner re-confirms development-only work may advance to a
      separately approved production change.
- [ ] AWS production existence and topology are verified from the AWS account,
      not inferred from repository documents.
- [ ] Compute, region, VPC, database, DNS/TLS, artifact registry, deployment
      method, rollback owner, and maintenance window are approved.
- [ ] Embedded-worker constraint is resolved: exactly one API task, or an
      independently reviewed multi-replica/worker design.
- [ ] No unrelated stale AWS deployment instructions will be followed.

### Gate B — GHL production configuration

- [ ] Production GHL location identity is verified by two reviewers.
- [ ] Eight existing custom fields and all proposed EMA fields are reviewed for
      stable identity, type, uniqueness, and duplicate names.
- [ ] Production workflows, automations, triggers, DND/consent behavior,
      duplicate-contact rules, and duplicate-opportunity rules are documented.
- [ ] The business pipeline and stage are explicitly selected and approved;
      neither value is guessed or inferred from similarly named records.
- [ ] The mapping is configured to maintain exactly one opportunity per EMA
      lead, including retry, conflict, and reconciliation cases.
- [ ] No ambiguous existing opportunity is automatically adopted.
- [ ] Setup-script plan/output has been reviewed; any production execution has
      its own future implementation and approval. Current setup code rejects
      production rather than accepting a production flag.

### Gate C — database safety

- [ ] A restorable production database snapshot/backup is completed and its
      identifier and retention are recorded.
- [ ] Restore procedure and restore target have been reviewed; a recent restore
      test is evidenced.
- [ ] Versioned migration SQL is checked in, additive, peer-reviewed, and tested
      against a production-like copy with synthetic data.
- [ ] Lock duration, runtime, failure behavior, and forward-fix/rollback plan
      are accepted.
- [ ] Application feature/write flag is confirmed off before migration.
- [ ] Approved one-off migration runner applies exactly the pinned migration;
      schema push is not used.
- [ ] Migration history and expected tables/columns/indexes are verified.
- [ ] The release migration plan lists exactly 0001, 0002, and 0003; the
      pre-commit schema assertion confirms the five provider-failure diagnostic
      columns on `ema_ghl_attempts` before delivery is enabled.
- [ ] Existing application health and lead capture are verified while the GHL
      feature remains off.

### Gate D — deploy dark

- [ ] Immutable artifact digest and release commit match the reviewed release.
- [ ] AWS production secrets were created independently, are least-privileged,
      and are not present in Replit or build output by virtue of this rollout.
- [ ] GHL credentials and configuration resolve in the task, but all GHL writes
      remain disabled. Do not enable current delivery merely to validate config:
      its production environment gate intentionally rejects it. The setup script
      also remains production-ineligible.
- [ ] Deployment reaches healthy status on `/api/healthz`.
- [ ] Existing individual, overstay, and business lead behavior is smoke-tested
      without GHL writes.
- [ ] Delivery records do not include pre-enable historical leads; no backfill
      job or command is configured.
- [ ] Logs and metrics show no attempted live GHL mutations.

### Gate E — isolated end-to-end evidence

- [ ] Isolated test database and GHL test-location identity are re-confirmed
      immediately before testing.
- [ ] Test-location automation and duplicate configuration review is complete.
- [ ] Only synthetic data is used.
- [ ] All three assessment flows preserve current validation and duplicate
      responses and deliver only after successful finalization.
- [ ] Immutable initial answers, separate captured UTM values, original
      attribution, and full funnel context are verified.
- [ ] Overstay and business lead + immutable assessment + delivery event
      atomicity is demonstrated.
- [ ] Retry, lease recovery, conflict handling, links, and remote
      reconciliation are demonstrated without duplicates.
- [ ] Each synthetic EMA lead has one contact relationship and exactly one
      opportunity in the explicitly configured pipeline/stage.
- [ ] No messages or other unintended automations fired.

### Gate F — limited production enablement

- [ ] A separate production-write change is approved; development approval
      alone is not treated as authorization.
- [ ] On-call owner, observation window, stop conditions, and rollback steps
      are active.
- [ ] Feature is enabled only for the approved new-lead scope/canary supported
      by the implementation; if no safe narrow scope exists, stop and obtain a
      revised plan.
- [ ] One newly finalized, explicitly authorized production lead is observed
      end to end before broader enablement.
- [ ] The lead has the correct contact link and exactly one opportunity in the
      approved pipeline and business stage.
- [ ] Consent, DND, newer values, attribution, assessment history, and duplicate
      behavior are correct; no unexpected automation fired.
- [ ] Retry/reconciliation telemetry is healthy before increasing scope.
- [ ] No historical leads are queued or backfilled.

### Gate G — completion

- [ ] Observation window completes with no duplicate opportunities, sustained
      backlog, exhausted retries, unresolved conflicts, or lease failures.
- [ ] Final flag/config state, migration version, artifact digest, GHL location,
      pipeline/stage IDs, and evidence are recorded without secret values.
- [ ] Alerts, dashboards, ownership, credential rotation, and incident
      procedures are handed to operations.
- [ ] Stale topology documents are scheduled for separate correction; this
      GHL rollout does not silently rewrite or validate them.

## Stop and rollback

Immediately disable the GHL integration using the **release-verified** feature
control if any of these occur: wrong location/pipeline/stage, any live write
before approval, duplicate opportunity, unexpected automation/message,
consent/DND regression, PII/token exposure, sustained queue failure, ambiguous
reconciliation, or database/application health degradation.

Disabling delivery is the first response; do not delete remote records or run a
compensating backfill. Preserve logs and delivery events, stop rollout scope,
and reconcile under an incident/change record. Roll back the application
artifact only if it is compatible with the already-applied additive migration.
Prefer a reviewed forward fix to reversing schema once production delivery data
exists. Database restore is a last-resort incident action because it can lose
unrelated leads captured after the backup.