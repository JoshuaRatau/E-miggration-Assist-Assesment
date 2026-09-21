// Explicit opt-in; importing this file never imports application startup.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildPgPoolConfig } from "../lib/db/src/ssl.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const names = fs.readdirSync(dir).filter(n => /^000[12]_.*\.sql$/.test(n)).sort();
if (names.length !== 2) throw new Error("Expected reviewed 0001 and 0002 migrations");
const migrations = names.map(name => {
  const sql = fs.readFileSync(path.join(dir, name), "utf8");
  return { name, sql, hash: crypto.createHash("sha256").update(sql).digest("hex") };
});
if (process.argv.includes("--plan")) {
  console.log(JSON.stringify(migrations.map(({ name, hash }) => ({ name, hash })), null, 2));
} else {
  if (!process.argv.includes("--apply") || process.env.EMA_APPLY_MIGRATIONS !== "approved" || !process.env.DATABASE_URL)
    throw new Error("Requires --apply, EMA_APPLY_MIGRATIONS=approved and externally supplied DATABASE_URL. --plan needs no database.");
  const client = new pg.Client({ ...buildPgPoolConfig(process.env.DATABASE_URL), connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(724301882)");
    const ledger = await client.query("SELECT to_regclass('public.ema_release_migrations') AS name");
    // Do not silently adopt pre-ledger migrations or guess at constraints/indexes.
    if (!ledger.rows[0].name) {
      const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'ema_ghl_%' OR tablename='ema_assessment_submissions')");
      if (existing.rowCount) throw new Error("Existing GHL schema without migration ledger: STOP for operator schema/constraint/index review; automatic adoption is forbidden.");
    }
    await client.query("CREATE TABLE IF NOT EXISTS public.ema_release_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const migration of migrations) {
      const prior = await client.query("SELECT sha256 FROM public.ema_release_migrations WHERE name=$1", [migration.name]);
      if (prior.rowCount) {
        if (prior.rows[0].sha256 !== migration.hash) throw new Error(`Migration hash mismatch: ${migration.name}`);
        continue;
      }
      // Existing reviewed SQL wraps itself in BEGIN/COMMIT. Strip only the
      // outer pair so the ledger and BOTH migrations remain one transaction.
      const sql = migration.sql.replace(/^((?:\s|--[^\n]*\n)*)BEGIN\s*;/i, "$1").replace(/COMMIT\s*;\s*$/i, "");
      await client.query(sql);
      await client.query("INSERT INTO public.ema_release_migrations(name,sha256) VALUES($1,$2)", [migration.name, migration.hash]);
      console.log(`Applied ${migration.name}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // SQL/connection error details can contain credentials; do not dump them.
    console.error("Migration failed and transaction rolled back; operator review required.", err instanceof Error && /^(Existing GHL|Migration hash)/.test(err.message) ? err.message : "");
    process.exitCode = 1;
  } finally { await client.end(); }
}