---
name: Drizzle push SSL workaround
description: How to apply DB schema changes when drizzle-kit push fails locally
---

Running the drizzle-kit push script fails in this environment with
`server does not support SSL`. The real push script is
`pnpm --filter @workspace/db run push` (the root `db:push` alias may be absent).

**Workaround:** create/alter tables directly with `executeSql({ sqlQuery })` in
the code_execution sandbox (shares the same DATABASE_URL). Verified working for
table creation and ad-hoc DELETE cleanup of test rows.

**Why:** drizzle-kit's connection negotiates SSL in a way the local Postgres
rejects; the raw executeSql path does not, so it is the reliable channel for
schema/data changes during a session.
