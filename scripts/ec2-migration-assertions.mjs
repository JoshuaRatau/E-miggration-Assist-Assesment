import crypto from "node:crypto";

export const APPROVED_MIGRATION_HASHES = Object.freeze({
  "0001_ema_ghl_outbox.sql": "325b1b6b5605402b6102cd8df734e794c4645618cb363db885d97f585e56b625",
  "0002_ema_ghl_production.sql": "146fe4f0a6f38038ed3e4fd71683a852cd1a2682be686c1b4675318577592fb0",
});

const REQUIRED_COLUMNS = Object.freeze({
  ema_assessment_submissions: ["id", "lead_id", "flow", "answers", "attribution", "captured_at", "completed_at"],
  ema_ghl_operations: ["id", "submission_id", "environment", "location_id", "kind", "ordinal", "state", "attempts", "available_at", "lease_token", "lease_until", "remote_id", "result", "error_code", "confirmed_at"],
  ema_ghl_attempts: ["id", "operation_id", "action", "started_at", "finished_at", "outcome", "http_status", "error_code"],
  ema_ghl_links: ["environment", "location_id", "lead_id", "contact_id", "opportunity_id", "latest_completed_at"],
  ema_ghl_worker_leases: ["scope", "token", "expires_at"],
  ema_ghl_mutation_barriers: ["scope", "operation_id", "action", "created_at"],
});

export function assertionError(code) {
  return Object.assign(new Error(), { safeCode: code });
}

export function ensureAssertion(value, code) {
  if (!value) throw assertionError(code);
}

export function normalizeMigrationSql(raw) {
  const withoutBegin = raw.replace(/^((?:\s|--[^\n]*\n)*)BEGIN\s*;/i, "$1");
  const sql = withoutBegin.replace(/COMMIT\s*;\s*$/i, "");
  ensureAssertion(withoutBegin !== raw && sql !== withoutBegin, "TRANSACTION_WRAPPER");
  return sql;
}

export function prepareApprovedMigrations(readMigration) {
  return Object.entries(APPROVED_MIGRATION_HASHES).map(([name, hash]) => {
    const raw = readMigration(name);
    ensureAssertion(
      crypto.createHash("sha256").update(raw).digest("hex") === hash,
      "MIGRATION_HASH_MISMATCH",
    );
    const sql = normalizeMigrationSql(raw);
    return { name, hash, raw, sql };
  });
}

export async function verifyApprovedSchema(client, migrations) {
  const expectedFunction = migrations[0].raw.split("AS $$")[1]?.split("$$;")[0]?.trim();
  ensureAssertion(expectedFunction, "APPROVED_SQL_ASSERTION");

  const ledger = await client.query(
    "SELECT name,sha256 FROM public.ema_release_migrations WHERE name=ANY($1::text[])",
    [Object.keys(APPROVED_MIGRATION_HASHES)],
  );
  ensureAssertion(
    ledger.rows.length === 2 &&
      ledger.rows.every(row => APPROVED_MIGRATION_HASHES[row.name] === row.sha256),
    "LEDGER_ASSERTION",
  );

  const tables = await client.query(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])",
    [Object.keys(REQUIRED_COLUMNS)],
  );
  ensureAssertion(tables.rows.length === 6, "TABLE_ASSERTION");

  const columns = await client.query(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])",
    [Object.keys(REQUIRED_COLUMNS)],
  );
  const presentColumns = new Set(columns.rows.map(row => `${row.table_name}:${row.column_name}`));
  ensureAssertion(
    Object.entries(REQUIRED_COLUMNS).every(([table, names]) =>
      names.every(name => presentColumns.has(`${table}:${name}`))),
    "COLUMN_ASSERTION",
  );

  const checks = await client.query(`SELECT conrelid::regclass::text AS table_name, pg_get_expr(conbin,conrelid) AS expression, convalidated
    FROM pg_constraint WHERE contype='c' AND
    ((conrelid='public.ema_ghl_operations'::regclass AND conname='ema_ghl_operations_environment_check')
    OR (conrelid='public.ema_ghl_links'::regclass AND conname='ema_ghl_links_environment_check'))`);
  const environmentExpression =
    "(environment = ANY (ARRAY['development'::text, 'test'::text, 'production'::text]))";
  ensureAssertion(
    checks.rows.length === 2 &&
      checks.rows.every(row => row.convalidated && row.expression === environmentExpression),
    "ENVIRONMENT_CHECK_ASSERTION",
  );

  const trigger = await client.query(`SELECT t.tgtype,t.tgenabled,p.prosrc,p.prorettype='trigger'::regtype AS returns_trigger,l.lanname
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
    WHERE t.tgrelid='public.ema_assessment_submissions'::regclass AND t.tgname='ema_snapshot_immutable'
    AND NOT t.tgisinternal AND n.nspname='public' AND p.proname='ema_snapshot_immutable'`);
  ensureAssertion(
    trigger.rows.length === 1 &&
      Number(trigger.rows[0].tgtype) === 19 &&
      ["O", "A"].includes(trigger.rows[0].tgenabled) &&
      trigger.rows[0].returns_trigger &&
      trigger.rows[0].lanname === "plpgsql" &&
      trigger.rows[0].prosrc.trim() === expectedFunction,
    "IMMUTABILITY_ASSERTION",
  );

  const index = await client.query(`SELECT i.indisunique,i.indisvalid,i.indisready,
    pg_get_expr(i.indpred,i.indrelid) AS predicate,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns
    FROM pg_index i WHERE i.indexrelid=to_regclass('public.ema_ghl_opportunity_owner')
      AND i.indrelid='public.ema_ghl_links'::regclass`);
  ensureAssertion(
    index.rows.length === 1 &&
      index.rows[0].indisunique &&
      index.rows[0].indisvalid &&
      index.rows[0].indisready &&
      index.rows[0].predicate === "(opportunity_id IS NOT NULL)" &&
      JSON.stringify(index.rows[0].columns) ===
        JSON.stringify(["environment", "location_id", "opportunity_id"]),
    "OWNERSHIP_ASSERTION",
  );
}

export async function runApprovedMigrations(client, migrations, output = console) {
  let committed = false;
  let phase = "connection";
  try {
    await client.connect();
    phase = "transaction";
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO public");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(724301882)");
    const ledger = await client.query("SELECT to_regclass('public.ema_release_migrations') AS name");
    if (!ledger.rows[0].name) {
      const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'ema_ghl_%' OR tablename='ema_assessment_submissions')");
      ensureAssertion(!existing.rowCount, "UNRECORDED_SCHEMA");
    }
    await client.query("CREATE TABLE IF NOT EXISTS public.ema_release_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const migration of migrations) {
      phase = migration.name;
      const prior = await client.query("SELECT sha256 FROM public.ema_release_migrations WHERE name=$1", [migration.name]);
      if (prior.rowCount) {
        ensureAssertion(prior.rows[0].sha256 === migration.hash, "LEDGER_HASH_MISMATCH");
        continue;
      }
      await client.query(migration.sql);
      await client.query("INSERT INTO public.ema_release_migrations(name,sha256) VALUES($1,$2)", [migration.name, migration.hash]);
    }
    phase = "precommit_assertions";
    await verifyApprovedSchema(client, migrations);
    phase = "commit";
    await client.query("COMMIT");
    committed = true;
    phase = "postcommit_assertions";
    await client.query("BEGIN READ ONLY");
    await verifyApprovedSchema(client, migrations);
    await client.query("ROLLBACK");
    output.log("PASS: approved migration hashes and schema verified before COMMIT and again after COMMIT.");
    return { committed: true };
  } catch (err) {
    let rollbackConfirmed = false;
    try {
      await client.query("ROLLBACK");
      rollbackConfirmed = true;
    } catch {}
    const commitOutcome =
      phase === "commit"
        ? "UNKNOWN_REVIEW_LEDGER_BEFORE_RETRY"
        : committed
          ? "COMMITTED_POSTCOMMIT_FAILURE"
          : "NOT_COMMITTED";
    output.error(JSON.stringify({
      status: "STOP",
      phase,
      code: err?.safeCode || "REDACTED_EXECUTION_ERROR",
      committed,
      rollbackConfirmed,
      commitOutcome,
      activationPermitted: false,
    }));
    return { committed, failed: true, phase, commitOutcome };
  } finally {
    try { await client.end(); } catch {}
  }
}
