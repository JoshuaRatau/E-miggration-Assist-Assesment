# Existing EMA migrations: alternative safety gate

The user authorizes an alternative to externally verified AWS backup/PITR:
execute only additive, reversible, transactional changes, verify the complete
schema and migration ledger before COMMIT, and roll back on any failure.
AWS backup destination, retention, restore access and actual PITR coverage remain
unverified. WAL archiving counters do not establish those facts.

## Exact unchanged inputs

- `0001_ema_ghl_outbox.sql`:
  `325b1b6b5605402b6102cd8df734e794c4645618cb363db885d97f585e56b625`
- `0002_ema_ghl_production.sql`:
  `146fe4f0a6f38038ed3e4fd71683a852cd1a2682be686c1b4675318577592fb0`

Both local hashes match the approved preflight hashes. Neither SQL file was
changed or executed during this audit.

## Statement audit

0001 creates six tables, their constraints/indexes, a trigger function and an
immutability trigger. It does not insert, update or delete existing rows.
`BEFORE UPDATE` declares a trigger; it is not an UPDATE statement.

0002 contains these DROP operations:

    ALTER TABLE ema_ghl_operations DROP CONSTRAINT ema_ghl_operations_environment_check;
    ALTER TABLE ema_ghl_links DROP CONSTRAINT ema_ghl_links_environment_check;

Each is followed by ADD CONSTRAINT allowing development, test and production.
Given the confirmed absence of the six tables, these affect only empty tables
created by 0001 in the same transaction, not pre-existing application tables.
The intermediate constraint removal is not committed separately.

Neither file contains TRUNCATE, DELETE, UPDATE of existing rows, column removal,
type conversion, table rename, data transformation, CREATE INDEX CONCURRENTLY,
VACUUM, external calls or non-transactional DDL.

Both files contain outer BEGIN/COMMIT wrappers. Sending them unchanged inside
another transaction would be unsafe: the inner COMMIT could commit the outer
transaction. The existing runner strips those wrappers, retains the function's
PL/pgSQL BEGIN/END, and applies 0001 then 0002 under a single transaction.

## Existing production objects affected

`public.prelaunch_leads` is referenced by two new foreign keys:
`ema_assessment_submissions.lead_id` and `ema_ghl_links.lead_id`. PostgreSQL adds
referential-integrity trigger/dependency metadata to the referenced relation and
acquires DDL locks. Its rows, columns and existing indexes are not rewritten.
Once referencing rows exist, these foreign keys can prevent deletion/update of
referenced lead IDs. Therefore the migration is additive but not impact-free.

The public schema/catalog receives the new objects. No existing application
function or trigger is replaced: CREATE FUNCTION, rather than CREATE OR REPLACE,
fails on a name collision. The runner creates the new migration ledger and
inserts its two records in the same transaction.

## Decision

SQL-level gate: PASS conditional on the confirmed empty starting state, approved
hashes, correct public-schema resolution, and one transaction with wrapper
removal. These changes can be rolled back before commit; this is not a promise
that later application writes can be undone without data loss.

Execution is NOT complete:

1. The archive's original migrate.mjs remains unchanged and commits without
   full assertions. Use the updated ec2-api-release-ops.sh instead: it loads pg
   from the unchanged archive, applies the hash-pinned SQL, verifies the schema
   on the same transaction before COMMIT, then verifies again after COMMIT.
   The activation receipt is written only after all checks succeed.
2. The user now confirms authenticated ubuntu terminal access for operator
   execution. This does not give the agent a remote connection. Do not substitute
   the workspace database for production or claim operator commands ran here.

The external backup evidence gap is recorded, not treated as the sole blocker
under the user's alternative gate. No production mutation or GHL enablement was
performed. Existing controlled-test recipient restrictions still apply.