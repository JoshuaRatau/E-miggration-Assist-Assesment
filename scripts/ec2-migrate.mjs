// Explicit opt-in; importing this file never imports application startup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildPgPoolConfig } from "../lib/db/src/ssl.ts";
import {
  APPROVED_MIGRATION_HASHES,
  ensureAssertion,
  prepareApprovedMigrations,
  runApprovedMigrations,
} from "./ec2-migration-assertions.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export function loadApprovedMigrations(migrationsDir = dir) {
  const names = fs.readdirSync(migrationsDir).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
  ensureAssertion(
    names.length === Object.keys(APPROVED_MIGRATION_HASHES).length &&
      names.every(name => Object.hasOwn(APPROVED_MIGRATION_HASHES, name)),
    "MIGRATION_SET_MISMATCH",
  );
  return prepareApprovedMigrations(name => fs.readFileSync(path.join(migrationsDir, name), "utf8"));
}

async function main() {
  let migrations;
  try {
    migrations = loadApprovedMigrations();
    if (process.argv.includes("--plan")) {
      console.log(JSON.stringify(migrations.map(({ name, hash }) => ({ name, hash })), null, 2));
      return;
    }
    ensureAssertion(
      process.argv.includes("--apply") &&
        process.env.EMA_APPLY_MIGRATIONS === "approved" &&
        process.env.DATABASE_URL,
      "MIGRATION_APPROVAL_REQUIRED",
    );
    const client = new pg.Client({
      ...buildPgPoolConfig(process.env.DATABASE_URL),
      connectionTimeoutMillis: 10000,
    });
    const result = await runApprovedMigrations(client, migrations);
    if (result.failed) process.exitCode = 1;
  } catch (err) {
    console.error(JSON.stringify({
      status: "STOP",
      phase: "configuration",
      code: err?.safeCode || "REDACTED_CONFIGURATION_ERROR",
      committed: false,
      rollbackConfirmed: false,
      commitOutcome: "NOT_COMMITTED",
      activationPermitted: false,
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
