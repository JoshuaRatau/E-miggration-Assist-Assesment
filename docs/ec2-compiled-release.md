# Compiled EC2 release — preparation only

**Superseded capacity/topology assumptions:** The user subsequently confirmed only
184,020,992 bytes free, Node 22.22.2 at `/usr/bin/node`, and API-only Nginx proxying
to localhost:5000. The combined frontend/API candidate and 319 MB calculation
below are historical evidence, not the current deployment recommendation.
Use `docs/ec2-api-only-release.md` for the revised API-only handoff. Do not deploy
the candidate frontend or change its hosting.

No EC2 changes, pushes, deployment, swap changes or application database access are authorized. Current 319 MB free is **not yet a safe deployment approval**. `/swapfile` is active and untouchable.

## Build and dependency audit

Build in Replit, never install or compile on EC2. Run from repository root:

```sh
RELEASE_BASE_PATH=/assessment/ RELEASE_API_BASE='' node scripts/ec2-build-release.mjs
```

These are **candidate public routing inputs**, not confirmed EC2 routing. Vite defaults to `/assessment/`, embeds `BASE_URL` into routing/assets, and frontend requests append `/api` to `VITE_API_URL`. Empty API base means same-origin `/api`; `/assessment` means `/assessment/api`. API Express serves `/api` only and does not serve the frontend. Nginx must serve static files with SPA fallback and preserve/strip proxy prefixes appropriately. If frontend stays on Vercel, do not replace its EC2 static root; build/public is then optional on EC2.

Build subprocess has a minimal allowlisted environment and rejects root/frontend `.env*` inputs. Public frontend URL may not contain credentials/query parameters. No environment file, source map, native binary, PEM or key is packaged. Runtime secrets stay in existing external configuration; packaging never copies it. A clean immutable source checkout + frozen pnpm lockfile + same Node/pnpm and explicit routing inputs are required for reproducibility. Archive metadata and gzip timestamp are normalized. Dirty-worktree status is recorded; candidate builds are not release approval.

The existing API build was inspected first: 13.9 MiB entrypoint plus pino worker files, 38 MiB directory including sourcemaps. It leaves actual nodemailer/AWS/Google imports external. The release builder instead bundles ordinary JS and includes path-sensitive pino/pino-http (including workers), pg-boss, file-type and dependency closure, pg, nodemailer, S3 SDK and Google Storage as intact packages. Any runtime wasm in these packages is retained. Optional pg-native is intentionally absent; use pure JS pg. PGlite/dev dependencies are excluded, with an explicit error stub for isolated PGlite helpers. They are not production execution paths. No pnpm store links escape the artifact.

Minimum dependency requirement: **Node >=22.12.0** (pg-boss); tested build runtime **Node 24.13.0 Linux x86_64**. Archive is JS/assets, not a Node binary: EC2 must already have a compatible Node interpreter. Ubuntu/arm64 should be portable without native binaries, but is not independently tested. Do not claim an older installed EC2 Node works; version/arch/libc must be checked. Do not change server Node without separate approval/budget.

## One read-only server facts batch

Send/run the reviewed contents of `scripts/ec2-server-facts.sh` on EC2 as ubuntu. It targets confirmed repository `/home/ubuntu/E-miggration-Assist-Assesment`, PM2 `immigration-api` fork mode, filters PM2 fields before printing, and filters Nginx directives before printing. No full env dump, PM2 env, raw Nginx config, log contents or DB queries. Uses existing PM2 daemon only.

Together confirm: actual PM2 script/cwd/interpreter and log paths; installed Node/arch/libc; Nginx document root, proxy prefix/port, SPA fallback and active frontend host; external secret-loading mechanism/env-file **path only**; CA path if configured; upload persistence paths; DB **local or remote** (no URL/password), backup destination/size and migration history; current free bytes/inodes and logging growth. Git-repo HEAD alone is not the running entrypoint.

## Distribution and capacity

### Final-source candidate measurements (uncommitted, not a published release)

Sanitized candidate `/assessment/`, same-origin `/api` built successfully in Replit after production-support edits. Manifest records source checkout HEAD `15a50df6281a9eb6ac95566d18b2c028af28867c` **dirty=true**; that commit alone does not identify the uncommitted build and must not be presented as the deployed/published revision. Both 0001 and 0002 SQL files are included.

| Item | Bytes |
|---|---:|
| gzip archive length | 8,436,262 |
| gzip disk allocation | 8,437,760 |
| extracted apparent (`du -sb`) | 40,036,130 |
| extracted allocation (`du -sB1`) | 57,556,992 |
| entrypoint directory allocation | 13,631,488 |
| runtime dependency allocation | 39,948,288 |
| frontend allocation | 3,145,728 |

5,374 regular files (before checksum file); largest allocated trees: API 13,631,488 bytes, AWS S3 SDK 4,550,656, Smithy core 3,792,896, Node types 2,576,384 (transitive declared dependency), Luxon 1,896,448, Google Storage 1,847,296. Frontend JS is exactly 1,815,427 bytes; do not confuse network gzip size with on-disk release allocation. No `.node` or wasm file was required by this candidate's copied runtime closure. 178 runtime package versions are enumerated in the manifest. Reviewed unused optional externals: `supports-color` (debug catches absence) and `@react-email/render` (Resend optional React email, application sends text); new unreviewed externals fail the build.

Final candidate SHA-256: `73b01f073e50349498cc98a44360fba962aa531550b4dc316b3bb7d8890f537a`.
Two consecutive sanitized builds after the final source signal produced this identical SHA-256. Isolated verification passed after both builds.

Measured incremental archive + extraction: **65,994,752 bytes**. With 192 MiB provisional reserves: **267,321,344 bytes**, leaving only **51,678,656 bytes** if available space is exactly 319,000,000 bytes. Keeping an *additional* compiled rollback copy would require **324,878,336 bytes** including reserves and does **not** fit 319 MB. Retaining the already-existing runnable installation avoids that duplicate. Conditional arithmetic fits the existing-installation rollback strategy, but safety remains unproven until actual free space, DB backup/WAL, uploads and logging rates are known. Rebuild/re-measure after final GHL edits.

`node scripts/ec2-verify-release.mjs` extracts outside the workspace, clears inherited secrets, validates hashes/internal symlinks, syntax-checks the API without importing it, imports real packaged runtime dependencies, recognizes a synthetic JPEG signature, and executes pino's file worker. It runs migration `--plan` without a DB and uses a local mocked pg to verify runner transaction flow and safeguard rejection. It **never starts the application**. This is package/dependency smoke, not application boot/route/SQL/database/GHL validation.

Use a GitHub Release asset `ema-compiled.tar.gz` and its SHA-256 checksum tied to the reviewed source commit. Do not commit generated bundles or force them through `git pull`. GitHub publication is a later approved operation, not done here. Existing source-based workflow may continue for audit, but must not run install/build on EC2; avoid an unnecessary git pull at the disk peak.

Release builder prints exact compressed bytes, extracted apparent bytes, extracted allocated bytes; `release.json` records runtime packages, routing inputs and source commit. `SHA256SUMS` covers regular files. Measure receiving filesystem allocation too (4 KiB versus other block sizes can differ).

Budget with C=archive allocated bytes, E=new extracted allocated bytes:

* Existing running installation remains untouched and is the first rollback copy: peak incremental **C + E**, not a second full copy of existing node_modules.
* If policy requires another compiled rollback copy: **C + 2E**. Never copy the whole repo/store.
* Reserve at least **64 MiB logging + 64 MiB migration/WAL + 64 MiB emergency free space**, plus measured file-backed upload growth. These are provisional allowances, not measured production rates.
* Migration allowance cannot bound a local PostgreSQL backup/WAL burst without DB size/locality facts. Keep backup off this root volume where approved. Remote DB migration/backup space belongs on that DB host, not assumed zero everywhere.
* Neither 319 MB nor 319 MiB is precise enough; use `df -B1`. If peak plus reserves exceeds free bytes, STOP. No cleanup/removal/swap intervention is authorized.

## Review-ready deployment sequence (blocked on verified paths and approval)

Do not execute this procedure now. Paths below are proposed release layout, not assertions about today's entrypoint/root/env. Fill all host-derived fields from the read-only facts together before authorizing exact commands.

1. Approve immutable commit, public routing inputs, build/test evidence and checksum. Rebuild **after final GHL source/migration edits**. Verify no source changes occurred during build. Download release asset to proposed `$HOME/ema-releases/<commit>.tar.gz`; authenticate privately, not in shell history. Check checksum before extraction. Do not increase storage.
2. Recheck free bytes/inodes and growth budget. Extract into proposed `$HOME/ema-releases/<commit>/`, a previously nonexistent directory, never over repository, uploads, env, or active release. Run `sha256sum -c SHA256SUMS` there. Confirm all symlinks stay under release directory.
3. On already verified compatible Node, run `node --check api/index.mjs` and `node migrate.mjs --plan`. These do not start app/background workers or touch DB. Do not test normal startup against production as a “smoke test”: startup seeds admins/templates/lifecycle rules and starts score/queue/Meta workers.
4. Preserve external secret loader and uploads. Explicitly retain `NODE_ENV=production`; keep GHL capture and delivery controls disabled. Confirm exact environment control names against GHL runbook; do not treat build-time settings as runtime controls. Record old PM2 script/cwd/interpreter and old Nginx serving configuration securely without dumping env.
5. With separate migration approval and reviewed off-root DB backup, supply existing secrets via the verified loader (never copy into release), then execute `EMA_APPLY_MIGRATIONS=approved node <release>/migrate.mjs --apply`. Runner applies **0001 then 0002**, records name/SHA-256 ledger atomically, uses advisory lock/5-second lock timeout/60-second statement timeout and fails on hash drift. It does not apply initial 0000/base-schema migration. Existing GHL tables without ledger **fail closed for operator schema/constraints/index review**, never silently baseline. Plan mode needs no DB. Do not run `drizzle push` or force migration.
6. Only after confirming actual entrypoint and secret injection, retarget existing **immigration-api fork** process to `<release>/api/index.mjs` while preserving its verified cwd/port/interpreter/environment and unrelated processes. Exact PM2 mutation command remains blocked: `pm2 restart` alone cannot change an unknown script path, and deleting/recreating without an audited secret loader can lose environment. Do not fabricate an ecosystem file containing secrets.
7. If EC2 serves frontend, switch only verified Nginx site root/alias to `<release>/public` and keep correct SPA fallback/proxy; run `nginx -t` before graceful reload. If symlink-based current layout exists, switch that link atomically instead of guessing. No reboot.
8. Check local API health at verified port/prefix and public health through verified proxy, verify HTML and one hashed JS/CSS asset and a deep SPA route, then authenticated read-only dashboard access. Health JSON alone does not verify schema, GHL delivery or form-to-GHL. Monitor bounded recent logs privately for startup failures; never post secrets/PII. No test lead, email, GHL write or full form submission without existing gates.
9. Keep previous runnable files and recorded config throughout observation. On failure restore prior PM2 script/cwd/config and Nginx root/link, validate Nginx and gracefully reload/restart only relevant service. Additive migrations are not automatically reversed; old app should ignore new tables/expanded checks. DB restore/drop requires explicit separate review, not automatic rollback. Archive cleanup/old-release pruning needs separate approval; never delete current source, uploads, logs, secrets or swap to force fit.

Actual GHL delivery and full form-to-GHL proof remain separate from isolated tests and packaging checks. No extra recipient permission is implied by this deployment guide.