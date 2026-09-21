import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPROVED_MIGRATION_HASHES,
  normalizeMigrationSql,
  prepareApprovedMigrations,
  runApprovedMigrations,
} from "./ec2-migration-assertions.mjs";

const migrationDir = path.resolve("lib/db/drizzle");
const migrations = prepareApprovedMigrations(name =>
  fs.readFileSync(path.join(migrationDir, name), "utf8"));
const required = {
  ema_assessment_submissions: ["id", "lead_id", "flow", "answers", "attribution", "captured_at", "completed_at"],
  ema_ghl_operations: ["id", "submission_id", "environment", "location_id", "kind", "ordinal", "state", "attempts", "available_at", "lease_token", "lease_until", "remote_id", "result", "error_code", "confirmed_at"],
  ema_ghl_attempts: ["id", "operation_id", "action", "started_at", "finished_at", "outcome", "http_status", "error_code"],
  ema_ghl_links: ["environment", "location_id", "lead_id", "contact_id", "opportunity_id", "latest_completed_at"],
  ema_ghl_worker_leases: ["scope", "token", "expires_at"],
  ema_ghl_mutation_barriers: ["scope", "operation_id", "action", "created_at"],
};
const expectedFunction = migrations[0].raw.split("AS $$")[1].split("$$;")[0].trim();

class MockClient {
  constructor(scenario) {
    this.scenario = scenario;
    this.statements = [];
    this.assertionPass = 0;
  }

  async connect() {
    if (this.scenario === "connection") throw new Error("postgres://secret@example.invalid");
  }

  async end() {}

  async query(sql) {
    this.statements.push(sql);
    if (sql === "COMMIT" && this.scenario === "commitUnknown")
      throw new Error("connection lost with password=secret");
    if (this.scenario === "sqlFailure" && sql.includes("CREATE TABLE ema_assessment_submissions"))
      throw new Error("SQL included secret");
    if (sql.startsWith("SELECT to_regclass"))
      return { rows: [{ name: this.scenario === "unrecorded" ? null : "ema_release_migrations" }], rowCount: 1 };
    if (sql.startsWith("SELECT tablename FROM pg_tables"))
      return { rows: [{ tablename: "ema_ghl_operations" }], rowCount: 1 };
    if (sql.startsWith("SELECT sha256 FROM")) {
      if (this.scenario === "ledgerConflict")
        return { rows: [{ sha256: "wrong" }], rowCount: 1 };
      if (this.scenario === "replay")
        return { rows: [{ sha256: APPROVED_MIGRATION_HASHES[sql.includes("irrelevant") ? "" : migrations[this.statements.filter(s => s.startsWith("SELECT sha256 FROM")).length - 1]?.name] }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT name,sha256")) {
      this.assertionPass++;
      if (this.scenario === "ledger" || (this.scenario === "postcommit" && this.assertionPass === 2))
        return { rows: [], rowCount: 0 };
      return { rows: Object.entries(APPROVED_MIGRATION_HASHES).map(([name, sha256]) => ({ name, sha256 })), rowCount: 2 };
    }
    if (sql.startsWith("SELECT c.relname"))
      return { rows: this.scenario === "table" ? [] : Object.keys(required).map(relname => ({ relname })) };
    if (sql.startsWith("SELECT table_name,column_name"))
      return { rows: this.scenario === "column" ? [] : Object.entries(required).flatMap(([table_name, names]) => names.map(column_name => ({ table_name, column_name }))) };
    if (sql.includes("FROM pg_constraint"))
      return { rows: this.scenario === "constraint" ? [] : [1, 2].map(() => ({ convalidated: true, expression: "(environment = ANY (ARRAY['development'::text, 'test'::text, 'production'::text]))" })) };
    if (sql.includes("FROM pg_trigger"))
      return { rows: this.scenario === "trigger" ? [] : [{ tgtype: 19, tgenabled: "O", returns_trigger: true, lanname: "plpgsql", prosrc: expectedFunction }] };
    if (sql.includes("FROM pg_index"))
      return { rows: this.scenario === "ownership" ? [] : [{ indisunique: true, indisvalid: true, indisready: true, predicate: "(opportunity_id IS NOT NULL)", columns: ["environment", "location_id", "opportunity_id"] }] };
    return { rows: [], rowCount: 0 };
  }
}

async function run(scenario) {
  const client = new MockClient(scenario);
  const logs = [];
  const result = await runApprovedMigrations(client, migrations, {
    log(value) { logs.push(value); },
    error(value) { logs.push(value); },
  });
  return { client, result, logs };
}

for (const scenario of [
  "connection", "unrecorded", "ledgerConflict", "sqlFailure",
  "ledger", "table", "column", "constraint", "trigger", "ownership",
]) {
  const { client, result, logs } = await run(scenario);
  assert.equal(result.failed, true, scenario);
  assert.equal(result.committed, false, scenario);
  assert(!client.statements.includes("COMMIT"), `${scenario}: must not commit`);
  assert(client.statements.includes("ROLLBACK"), `${scenario}: must attempt rollback`);
  assert(!logs.join("").includes("secret"), `${scenario}: output must be redacted`);
}

{
  const { client, result } = await run("commitUnknown");
  assert.equal(result.commitOutcome, "UNKNOWN_REVIEW_LEDGER_BEFORE_RETRY");
  assert.equal(result.committed, false);
  assert.equal(client.statements.filter(sql => sql === "COMMIT").length, 1);
}

{
  const { client, result } = await run("postcommit");
  assert.equal(result.commitOutcome, "COMMITTED_POSTCOMMIT_FAILURE");
  assert.equal(result.committed, true);
  assert(client.statements.indexOf("COMMIT") < client.statements.lastIndexOf("SELECT name,sha256 FROM public.ema_release_migrations WHERE name=ANY($1::text[])"));
}

for (const scenario of ["success", "replay"]) {
  const { client, result } = await run(scenario);
  assert.deepEqual(result, { committed: true }, scenario);
  const commit = client.statements.indexOf("COMMIT");
  const ownershipChecks = client.statements
    .map((sql, index) => sql.includes("FROM pg_index") ? index : -1)
    .filter(index => index >= 0);
  assert(ownershipChecks[0] < commit && ownershipChecks[1] > commit, scenario);
  const searchPath = client.statements.indexOf("SET LOCAL search_path TO public");
  const firstMigration = client.statements.findIndex(sql => sql.includes("CREATE TABLE ema_assessment_submissions"));
  assert(searchPath > client.statements.indexOf("BEGIN"), scenario);
  if (scenario === "success") assert(searchPath < firstMigration, scenario);
  assert(client.statements.includes("SET LOCAL lock_timeout = '5s'"), scenario);
  assert(client.statements.includes("SET LOCAL statement_timeout = '60s'"), scenario);
  assert(client.statements.includes("SELECT pg_advisory_xact_lock(724301882)"), scenario);
}

assert.throws(
  () => prepareApprovedMigrations(name => fs.readFileSync(path.join(migrationDir, name), "utf8") + "\n"),
  error => error.safeCode === "MIGRATION_HASH_MISMATCH",
);
assert.throws(
  () => normalizeMigrationSql("SELECT 1;"),
  error => error.safeCode === "TRANSACTION_WRAPPER",
);

console.log("PASS canonical migration commit, rollback, hash, schema, and redaction guards");
