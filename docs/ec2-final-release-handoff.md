# API release preparation after cache cleanup

Nothing in this document authorizes execution. No EC2 changes, migration,
publication, pushes or real-lead activation were performed.

## Findings

- The repository API has no dotenv loader. `src/index.ts` imports the app and
  worker modules; `lib/db/src/index.ts` immediately reads `process.env.DATABASE_URL`.
  `PORT` is read from the inherited environment. Neither known `.env` file is
  automatically loaded merely by existing on disk. Never `source` them to guess
  the production configuration.
- The read-only batch `scripts/ec2-env-db-facts.sh` reads the existing PM2 child
  environment in memory, verifies the exact known entrypoint/cwd and flags,
  compares saved PM2 metadata, and uses only the installed pg library for
  read-only catalog queries. It does not start PM2 or the application.
  Matching `.env` values are NOT proof that a file was sourced. Matching inherited
  configuration and a saved PM2 entry establish the configuration to preserve,
  not which historic shell command originally supplied it.
- Individual finalisation is a two-part release: `assessment.tsx` sends
  `finalize:false`, awaits the finalisation helper's confirmed `{finalized:true}`,
  displays retryable failures and only then navigates/fires the Lead pixel.
  `src/lib/finalize-assessment.ts` supplies the response check.
  API `routes/leads.ts` durably finalises before acknowledging success.
  The API-only archive contains the server part, not the browser changes.
- Repository deployment evidence identifies the frontend host as Vercel:
  `vercel.json` builds `@workspace/emigration-assist` and serves
  `artifacts/emigration-assist/dist/public`. `replit.md` and
  `docs/AWS_DEPLOYMENT.md` identify the public assessment route as
  `https://www.emigration-assist.com/assessment/`, reverse-proxied by the separate
  marketing-site Vercel project to this repository's assessment Vercel project.
  The exact Vercel project hostname and current published revision are not
  recorded; this is repository evidence, not a fresh live-host verification.
- Release the compatible API first, then release the frontend finalisation fix
  through that existing assessment Vercel project. Use the confirmed EC2 API
  origin `https://api.emigration-assist.com` as the intended API base, not the
  stale Replit-backend example in older docs. Preserve the existing marketing
  rewrite/base-path arrangement after confirming project settings. No EC2
  frontend hosting change is needed. Do not publish either release now.

## Capacity and immutable transfer

The user reports 307,884,032 bytes free after removing only
`/home/ubuntu/.cache/pnpm/v11/metadata`.
The pinned API archive remains 5,056,381 bytes compressed and 37,097,472 allocated
when extracted. Original transfer/extraction plus 192 MiB reserves is
243,482,624 bytes, leaving 64,401,408 bytes.
Allow an additional conservative 1 MiB for this operations script, release
directory/symlink and migration receipt: total 244,531,200 bytes, leaving
63,352,832 bytes before further growth or backup needs. No safety reserve was cut.

Candidate SHA-256:
`40f7aabeccd94c90a0fe84d42f3713112bd5f193a72090fcf013c250def90419`.
The archive is byte-pinned, not yet a published immutable-source release.
Its manifest records the original dirty source checkout. Source review and
source/tag association must precede any approved GitHub publication. If the
reviewed clean-source rebuild changes this digest, regenerate and re-review
the pinned operations script rather than substituting another archive.

Transfer method, only after separate authorization:

1. Publish/download the exact reviewed archive as a GitHub Release asset and
   verify its SHA-256 on the operator workstation. No publication occurs now.
2. Through the operator's existing authenticated SSH/SFTP connection as ubuntu,
   upload the archive (binary mode) to this exact proposed destination:
   `/home/ubuntu/ema-api-40f7aabeccd94c90a0fe84d42f3713112bd5f193a72090fcf013c250def90419.tar.gz`.
3. Upload the reviewed `scripts/ec2-api-release-ops.sh` to
   `/home/ubuntu/ec2-api-release-ops.sh`. Verify the script against its reviewed
   local copy, including its pinned digest, before executing it.

The SSH hostname/key and GitHub asset URL are not verified, so no invented scp
or curl command is offered. Use the established connection, not credentials in
shell history. No git pull, on-server dependency install or build is needed.

## Remaining database/recovery gate

The read-only batch reports the two migration ledger statuses against the pinned
candidate hashes and integration schema/constraint/trigger/index readiness.

- No integration tables/ledger: backup first; separately authorize the packaged
  runner to apply 0001 then 0002.
- Matching ledger and schema: the runner verifies/skips recorded migrations.
- Existing integration tables without the runner's ledger, hash mismatch,
  partial schema, or unexplained constraints: stop for schema/history review.
  Do not automatically baseline, `drizzle push`, or force migrations.
- Loopback database endpoints may be tunnels; locality stays unknown until the
  operator identifies the actual database host. No database names/hosts/URLs or
  customer data are emitted.

**Backup is a separate requirement:** establish a recent recoverable backup or
PITR point for the actual database immediately before migration, with restore
instructions, access and retention verified. Use an existing approved off-root
backup destination/service and confirm its available capacity/cost; do not put a
dump on the 8 GB root disk or create new billed storage. For a local database,
off-host backup and WAL headroom must be demonstrated. For a remote database,
verify backup/WAL capacity on that host/service. A pg-boss/application health
response is not backup evidence.

Application rollback preserves the expanded schema. Database restore, which can
discard later writes, requires separate review and is never an automatic step.

## Exact future commands, not authorized to execute now

After the read-only report is reviewed, backup/recovery is verified and each
mutating phase is separately authorized:

```sh
bash /home/ubuntu/ec2-api-release-ops.sh stage --approved
bash /home/ubuntu/ec2-api-release-ops.sh migrate --approved
bash /home/ubuntu/ec2-api-release-ops.sh activate --approved
```

Do not run this block as an unattended chain. Review each result before the next
phase. The script checks the pinned hash, verifies extracted files, makes no
frontend/Nginx change, and never copies secrets into the release.

Activation stops only immigration-api, renames its existing dist directory to a
same-filesystem rollback path (no duplicate copy), and makes the original dist
path a symlink to the new release's api directory. Thus PM2's configured
`/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server/dist/index.mjs`,
working directory and `/usr/bin/node` remain unchanged. `pm2 restart` here
deliberately uses the same path; it is not being misused to retarget a process.
No `--update-env`, `pm2 delete`, `pm2 save`, Nginx reload or reboot is required.
Inherited production settings are retained; capture/delivery must be disabled.

It checks these health endpoints without creating a lead:
`http://127.0.0.1:5000/api/healthz` and
`https://api.emigration-assist.com/api/healthz`.
They establish HTTP readiness only, not schema correctness or GHL delivery.
Normal activation starts existing application workers; inspection never does.

On failed activation/health, separately authorized rollback command:

```sh
bash /home/ubuntu/ec2-api-release-ops.sh rollback --approved
```

Rollback removes only the verified new dist symlink, renames the retained original
directory back, restarts only immigration-api and checks both health endpoints.
The new release, archive, application data, env files and database remain intact.
Do not prune rollback files or remove swap.

## Next GHL action

The pending connection is Replit's HighLevel OAuth API connector, not browser
access to the GHL UI and not the existing private integration token. Its current
documented capabilities/scopes do not establish access to workflow action
recipient settings, so completing OAuth must not be presented as sufficient to
clear the recipient gate.

Next UI evidence: E-Migration Assist sub-account → Automation → Workflows →
All Workflows, filtered to Published, including folder contents, to identify
additional published workflows beyond the already-reviewed Facebook workflow.
Do not repeat the four draft reviews. Follow reachable workflows' recipient
action settings only after that inventory identifies a relevant path. Existing
bounded approval and recipient limits remain valid. No workflow edits are
authorized; neither package tests nor API access prove recipient safety.