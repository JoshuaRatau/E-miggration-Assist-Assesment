# EC2 API-only compiled release handoff

Preparation only. No EC2 change, install, migration, push, deployment, environment
change, database/network access, or GHL write was performed.

## Artifact and verification

Build and verify in Replit only, from the repository root (never on EC2):

```sh
node scripts/ec2-build-release.mjs --api-only
node scripts/ec2-verify-release.mjs --api-only
```

API-only mode does not invoke pnpm or Vite and does not create/copy `public/`.
It writes a separate `dist/ec2-api-release/` tree and
`dist/ema-api-compiled.tar.gz`, leaving the combined release outputs alone.
The archive retains the compiled API, migration runner, both SQL migrations,
runtime dependency closure (including pino workers), package manifests,
symlinks internal to the release, release manifest, and file checksums. It omits
source maps, TypeScript declarations, and package test/docs/example directories;
these are not Node runtime inputs. It contains no native `.node` file or env file.

Verified candidate from source HEAD
`5f467b8ce3295e07c720e59c564b2003810952ab` with `dirty=true`:

| Measurement | Exact bytes |
|---|---:|
| archive apparent length | 5,056,381 |
| archive allocation (local 512-byte accounting) | 5,058,560 |
| extracted apparent (`du -sb`) | 27,527,934 |
| extracted allocation (`du -sB1`) | 37,097,472 |
| archive + one extraction allocation | 42,156,032 |
| three 64 MiB reserves | 201,326,592 |
| required peak, retaining existing install as rollback | 243,482,624 |
| confirmed EC2 free bytes | 184,020,992 |
| shortfall | 59,461,632 |

SHA-256:
`40f7aabeccd94c90a0fe84d42f3713112bd5f193a72090fcf013c250def90419`.
Two consecutive builds produced the same bytes and checksum.

Verification extracted to a temporary directory, checked every `SHA256SUMS`
entry and internal symlink, syntax-checked the API without importing/starting
it, imported packaged externals, exercised file-type and the pino worker, ran
migration plan mode, and exercised migration safeguards using a local pg stub.
It made no real database or network request. The available local interpreter
was Node v24.13.0. Node v22.22.2 was not installed locally, so it was not
actually tested here; the artifact declares and satisfies package engine
compatibility of Node >=22.12.0, while the confirmed EC2 interpreter is
v22.22.2.

The candidate does **not** fit the confirmed free space while retaining all
three reserves. The active installation is the rollback copy; do not create a
duplicate rollback extraction. Archive filesystem allocation must be
remeasured on EC2 before any later approved operation.

## Confirmed server paths (not changed)

- PM2 process: `immigration-api` (online).
- Interpreter: `/usr/bin/node`, Node v22.22.2.
- Current script:
  `/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server/dist/index.mjs`.
- Current working directory:
  `/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server`.
- `api.emigration-assist.com` proxies `/` to `http://localhost:5000`.
- The API health route is `/api/healthz` (defined in `routes/health.ts`).
- Existing env files at repository root and `artifacts/api-server/.env` must be
  preserved; their loading mechanism is still unverified.
- No inspected Nginx directive serves this frontend. This API artifact makes no
  frontend-hosting assumption.

## Read-only disk-growth follow-up

Because capacity blocks deployment, use the single batch in
`scripts/ec2-disk-growth-facts.sh`, also pasted directly into the handoff.
It prints sizes, modification times and paths only, without file/log contents.
Recent modification times are clues, not proof of growth without a prior baseline.

Review results before separately authorizing any cleanup. Do not remove the
running install, env files, uploads, logs needed for rollback/audit, or swap.

## Execution order after blockers are resolved (not authorization to execute)

1. Inspect the targeted size inventory; identify candidates, but do not delete
   anything. Recovering space would need separate authorization. Remeasure before
   any future transfer; at least 59,461,632 additional bytes are needed under the
   present budget, plus any new growth or backup requirements.
2. Establish how the two known env files reach the running process without
   printing their contents. Confirm DB locality, migration state and an approved
   off-root backup. Do not replace or move the env files.
3. Use a GitHub Release API-only archive/checksum tied to reviewed immutable
   source. Retain the old runnable installation. Do not git-pull/install/build
   on this server at the space peak.
4. Stage and checksum-verify the new release; use `/usr/bin/node` for isolated
   package checks and migration plan. Migration apply remains separately gated.
   Keep production capture and delivery disabled.
5. Preserve the confirmed PM2 working directory, interpreter, port and external
   environment injection. Final activation command is blocked on the loader:
   do not use a guessed ecosystem file or `pm2 restart` as if it changed the
   configured script. No Nginx or frontend-hosting change is needed for this API.
6. After an approved activation, these are the health targets (not executed now):
   `http://127.0.0.1:5000/api/healthz` and
   `https://api.emigration-assist.com/api/healthz`.
   Health alone does not establish schema readiness or GHL delivery.
7. Roll back to the original recorded script and working directory above,
   preserving its dependency tree and secret injection. Do not reverse additive
   schema changes, delete provider records or reboot automatically.

## Remaining GHL live-test gate

The bounded live-write approval already exists and must not be requested again.
The outstanding gate is evidence that every reachable GHL automation cannot
send to recipients outside the approved boundary, followed immediately by the
documented inventory and email/phone collision checks. A GHL account owner must
provide read-only evidence for any additional published workflows and the
reachable paths from the approved contact/field/note/opportunity writes,
including staff notifications, BCC/forwarding/reply recipients and known visible
legacy/external subscriptions. The four draft workflows and duplicate settings
already reviewed do not need another review. A Facebook-only trigger is not
reached by API-created contacts unless an indirect enrolment path exists.
Complete the pending HighLevel connection for automated inspection, or provide
redacted GHL UI evidence covering those specific gaps. A separate private-token
401 does not diagnose that OAuth flow. Do not change automations to clear this
gate. If other recipients cannot be excluded, keep live execution paused.
Mocked/package verification is not proof of live delivery; the isolated
three-assessment harness also does not establish a full browser form-to-GHL flow.