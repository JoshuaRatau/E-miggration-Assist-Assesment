// Isolated PostgreSQL test only. Caller supplies a disposable local cluster.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const [release, port] = process.argv.slice(2);
assert(release.startsWith("/tmp/") && /^\d+$/.test(port));
const pg = createRequire(path.join(release, "package.json"))("pg");
const url = `postgres://runner@127.0.0.1:${port}/postgres`;
const api = "/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server";
const script = fs.readFileSync("scripts/ec2-api-release-ops.sh", "utf8")
  .split("<<'NODE'\n")[1].split("\nNODE")[0].replace("void (async", "(async");
const baseline = new pg.Client({ connectionString: url });
const injections = {
  ledger: "DELETE FROM ema_release_migrations WHERE name='0002_ema_ghl_production.sql'",
  table: "DROP TABLE ema_ghl_attempts",
  column: "ALTER TABLE ema_ghl_operations DROP COLUMN result",
  constraint: "ALTER TABLE ema_ghl_operations DROP CONSTRAINT ema_ghl_operations_environment_check",
  trigger: "ALTER TABLE ema_assessment_submissions DISABLE TRIGGER ema_snapshot_immutable",
  ownership: "DROP INDEX ema_ghl_opportunity_owner",
};
async function run(scenario) {
  let injected = false;
  const statements = [];
  const mockProcess = { argv: ["node", "-", api, release], exitCode: 0 };
  const errors = [];
  class TestClient extends pg.Client {
    async query(sql, args) {
      statements.push(sql);
      if (!injected && sql.startsWith("SELECT name,sha256") && injections[scenario]) {
        injected = true;
        await super.query(injections[scenario]);
      }
      if (scenario === "sqlFailure" && sql.includes("ALTER TABLE ema_ghl_operations DROP")) {
        await super.query("SELECT deliberately_missing_function()");
      }
      return super.query(sql, args);
    }
  }
  const env = {
    name: "immigration-api", pm_exec_path: api + "/dist/index.mjs",
    DATABASE_URL: url, NODE_ENV: "production",
    EMA_GHL_CAPTURE_ENABLED: "false", EMA_GHL_DELIVERY_ENABLED: "false",
  };
  const mockFs = {
    ...fs,
    readdirSync(p) {
      return p === "/home/ubuntu/.pm2/pids" ? ["immigration-api-0.pid"] : fs.readdirSync(p);
    },
    readlinkSync(p) { return p === "/proc/123/cwd" ? api : fs.readlinkSync(p); },
    readFileSync(p, ...args) {
      if (p === "/home/ubuntu/.pm2/pids/immigration-api-0.pid") return "123";
      if (p === "/proc/123/environ") return Object.entries(env).map(([k,v]) => k+"="+v).join("\0");
      const value = fs.readFileSync(p, ...args);
      return scenario === "badHash" && p.endsWith("0001_ema_ghl_outbox.sql") ? value + "\n" : value;
    },
  };
  await vm.runInNewContext(script, {
    require(name) {
      if (name === "node:fs") return mockFs;
      if (name === "node:module") return { createRequire: () => () => ({ Client: TestClient }) };
      return require(name);
    },
    process: mockProcess, URL, console: { log() {}, error(x) { errors.push(x); } },
  });
  return { status: mockProcess.exitCode, statements, errors };
}
async function reset() {
  await baseline.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE public.prelaunch_leads(id uuid PRIMARY KEY); INSERT INTO prelaunch_leads VALUES('00000000-0000-0000-0000-000000000001')");
}
(async () => {
  await baseline.connect();
  try {
    for (const scenario of [...Object.keys(injections), "sqlFailure", "badHash"]) {
      await reset();
      const result = await run(scenario);
      assert.equal(result.status, 1, scenario);
      assert(!result.statements.includes("COMMIT"), scenario + ": committed failure");
      const objects = await baseline.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      assert.deepEqual(objects.rows.map(r => r.tablename), ["prelaunch_leads"], scenario);
      assert.equal((await baseline.query("SELECT count(*)::int AS n FROM prelaunch_leads")).rows[0].n, 1);
      console.log("PASS rollback/fail-closed:", scenario);
    }
    await reset();
    for (const scenario of ["success", "replay"]) {
      const result = await run(scenario);
      assert.equal(result.status, 0, JSON.stringify(result.errors));
      assert.equal(result.statements.filter(s => s === "COMMIT").length, 1);
      const commitIndex = result.statements.indexOf("COMMIT");
      const assertionIndex = result.statements.findIndex(s => s.includes("i.indisunique"));
      assert(assertionIndex > 0 && assertionIndex < commitIndex);
      assert(result.statements.slice(commitIndex + 1).some(s => s.includes("i.indisunique")));
      console.log("PASS before/after commit:", scenario);
    }
  } finally { await baseline.end(); }
})().catch(err => { console.error(err); process.exitCode = 1; });