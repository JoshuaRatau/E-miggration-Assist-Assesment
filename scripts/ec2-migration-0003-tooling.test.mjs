import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APPROVED_MIGRATION_HASHES, prepareApprovedMigrations } from "./ec2-migration-assertions.mjs";

const root = path.resolve(".");
const migrationDir = path.join(root, "lib/db/drizzle");
const names = [
  "0001_ema_ghl_outbox.sql",
  "0002_ema_ghl_production.sql",
  "0003_ema_ghl_provider_failure_diagnostics.sql",
  "0004_ema_ghl_single_case.sql",
  "0005_ema_intake_receipts.sql",
];

assert.deepEqual(Object.keys(APPROVED_MIGRATION_HASHES), names);
for (const name of names) {
  const bytes = fs.readFileSync(path.join(migrationDir, name));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), APPROVED_MIGRATION_HASHES[name]);
}
assert.deepEqual(
  prepareApprovedMigrations(name => fs.readFileSync(path.join(migrationDir, name), "utf8"))
    .map(({ name }) => name),
  names,
);

const toolBuild = fs.readFileSync(path.join(root, "artifacts/api-server/scripts/build-ghl-tools.mjs"), "utf8");
const migrationRunner = fs.readFileSync(path.join(root, "scripts/ec2-migrate.mjs"), "utf8");
const productionAssertion = fs.readFileSync(
  path.join(root, "artifacts/api-server/src/lib/ghl/production.ts"),
  "utf8",
);
assert(toolBuild.includes('"0003_ema_ghl_provider_failure_diagnostics.sql"'));
assert(toolBuild.includes('"0004_ema_ghl_single_case.sql"'));
assert(toolBuild.includes('"0005_ema_intake_receipts.sql"'));
assert(migrationRunner.includes("/^\\d{4}_.*\\.sql$/"));
assert(migrationRunner.includes("names.length === Object.keys(APPROVED_MIGRATION_HASHES).length"));
for (const column of [
  "provider_response", "correlation_id", "correlation_source",
  "provider_failure_reason", "classification_source",
]) assert(productionAssertion.includes(column));

console.log("PASS 0003 hash, exact migration set, packaging, and worker schema assertion");