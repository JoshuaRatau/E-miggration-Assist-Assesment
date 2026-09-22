import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prepareApprovedMigrations, runApprovedMigrations } from "./ec2-migration-assertions.mjs";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite");
const pg = new PGlite();
const migrations = prepareApprovedMigrations(name => readFileSync(`lib/db/drizzle/${name}`, "utf8"));
const logs = [];
const client = {
  async connect() {},
  async end() {},
  async query(sql, params) {
    if (!params && /;\s*\S/.test(sql)) {
      const result = (await pg.exec(sql)).at(-1);
      return { ...result, rowCount: result.rows.length };
    }
    const result = await pg.query(sql, params);
    return { ...result, rowCount: result.rows.length };
  },
};
try {
  await pg.exec("CREATE TABLE prelaunch_leads(id uuid PRIMARY KEY)");
  assert.deepEqual(await runApprovedMigrations(client, migrations, {
    log: value => logs.push(value), error: value => logs.push(value),
  }), { committed: true }, JSON.stringify(logs));
  assert.deepEqual(await runApprovedMigrations(client, migrations, {
    log: value => logs.push(value), error: value => logs.push(value),
  }), { committed: true }, JSON.stringify(logs));
  await pg.query("INSERT INTO ema_ghl_cases VALUES ('test','location','contact','opportunity')");
  await assert.rejects(pg.query("INSERT INTO ema_ghl_cases VALUES ('test','location','contact','second')"));
  await assert.rejects(pg.query("INSERT INTO ema_ghl_cases VALUES ('test','location','other','opportunity')"));
  const lead = "10000000-0000-4000-8000-000000000001";
  const attempt = "20000000-0000-4000-8000-000000000001";
  await pg.query("INSERT INTO prelaunch_leads VALUES ($1)", [lead]);
  await pg.query("INSERT INTO ema_intake_receipts(attempt_id,flow,request_hash,lead_id) VALUES($1,'individual',$2,$3)",
    [attempt, "a".repeat(64), lead]);
  await assert.rejects(pg.query("INSERT INTO ema_intake_receipts(attempt_id,flow,request_hash,lead_id) VALUES($1,'business',$2,$3)",
    [attempt, "b".repeat(64), lead]));
  for (const [flow, hash, owner] of [
    ["invalid", "a".repeat(64), lead],
    ["individual", "not-a-hash", lead],
    ["individual", "a".repeat(64), "10000000-0000-4000-8000-000000000002"],
  ]) await assert.rejects(pg.query(
    "INSERT INTO ema_intake_receipts(attempt_id,flow,request_hash,lead_id) VALUES('20000000-0000-4000-8000-000000000002',$1,$2,$3)",
    [flow, hash, owner]));
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM ema_intake_receipts")).rows[0].count, 1);
  console.log("PASS real isolated PostgreSQL migration assertions, ledger replay and single-case ownership constraints");
} finally {
  await pg.close();
}