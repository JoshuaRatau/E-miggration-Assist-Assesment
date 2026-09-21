#!/usr/bin/env bash
# Targeted, read-only EC2 check. It never sources env files or imports the app.
(
set -u

repo=/home/ubuntu/E-miggration-Assist-Assesment
api=$repo/artifacts/api-server
node=/usr/bin/node

if [[ ! -x "$node" || ! -r "$api/package.json" ]]; then
  printf '%s\n' '{"ok":false,"stage":"prerequisites","databaseProbe":"stopped"}'
  exit 1
fi

env -u NODE_OPTIONS -u NODE_PATH "$node" - "$repo" "$api" <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { parseEnv } = require("node:util");

void (async function main() {
const [repo, api] = process.argv.slice(2);
const name = "immigration-api";
const expected = new Map([
  ["0001_ema_ghl_outbox.sql", "325b1b6b5605402b6102cd8df734e794c4645618cb363db885d97f585e56b625"],
  ["0002_ema_ghl_production.sql", "146fe4f0a6f38038ed3e4fd71683a852cd1a2682be686c1b4675318577592fb0"],
]);
const keys = ["DATABASE_URL", "DATABASE_SSL_CA", "DATABASE_SSL_REJECT_UNAUTHORIZED", "NODE_OPTIONS", "NODE_PATH",
  "NODE_ENV", "EMA_GHL_CAPTURE_ENABLED", "EMA_GHL_DELIVERY_ENABLED"];
const out = { ok: false, pm2: {}, environment: {}, savedDump: {}, envFiles: [], databaseProbe: "stopped" };
const emit = (code = 0) => { console.log(JSON.stringify(out, null, 2)); process.exitCode = code; };
const same = (a, b, key) =>
  Object.prototype.hasOwnProperty.call(a, key) === Object.prototype.hasOwnProperty.call(b, key) &&
  (!Object.prototype.hasOwnProperty.call(a, key) || a[key] === b[key]);
const selectedConsistent = (a, b) => keys.every(k => same(a, b, k));

let candidates = [];
try {
  const pidDir = path.join(os.homedir(), ".pm2/pids");
  for (const file of fs.readdirSync(pidDir).filter(x => /^immigration-api-\d+\.pid$/.test(x))) {
    const pid = Number(fs.readFileSync(path.join(pidDir, file), "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid < 2) continue;
    let env = {};
    for (const entry of fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0")) {
      const at = entry.indexOf("=");
      if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1);
    }
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    const execPath = env.pm_exec_path ? path.resolve(cwd, env.pm_exec_path) : "";
    if (cwd === api && env.name === name && execPath === `${api}/dist/index.mjs`)
      candidates.push({ pid, env });
  }
} catch {
  candidates = [];
}
out.pm2.pidFilesOnly = true;
out.pm2.singleVerifiedProcess = candidates.length === 1;
if (candidates.length !== 1) {
  emit(1);
  return;
}

const { pid, env: active } = candidates[0];
let cmdline = "";
try {
  cmdline = fs.readFileSync(`/proc/${pid}/cmdline`).toString().split("\0").join(" ");
} catch {
  out.environment.activeProcessReadable = false;
  emit(1);
  return;
}
const hasDb = typeof active.DATABASE_URL === "string" && active.DATABASE_URL.length > 0;
// PM2 can change process.title, obscuring original command-line flags.
const launchText = `${cmdline} ${active.node_args || ""} ${active.NODE_OPTIONS || ""}`;
const loaderFlags = /--env-file|--require|--import|(?:^|[\s"',\[])-r/.test(launchText) ||
  Boolean(active.NODE_PATH);
const bundleLoaderMarkers = /dotenv|loadEnvFile|--env-file/.test(
  fs.readFileSync(path.join(api, "dist/index.mjs"), "utf8"));
out.environment = {
  activeProcessReadable: true,
  databaseUrlPresent: hasDb,
  preloadOrEnvFileFlagPresent: loaderFlags,
  activeBundleLoaderMarkersPresent: bundleLoaderMarkers,
  inheritedDatabaseUrlProven: hasDb && !loaderFlags && !bundleLoaderMarkers,
  NODE_ENV_is_production: active.NODE_ENV === "production",
  GHL_capture_disabled: active.EMA_GHL_CAPTURE_ENABLED !== "true",
  GHL_delivery_disabled: active.EMA_GHL_DELIVERY_ENABLED !== "true",
};

try {
  const dump = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pm2/dump.pm2"), "utf8"));
  const saved = Array.isArray(dump) ? dump.filter(p => p?.name === name) : [];
  out.savedDump = {
    readable: true,
    singleNamedEntry: saved.length === 1,
    selectedEnvironmentConsistentWithActive: saved.length === 1 && selectedConsistent(saved[0], active),
    databaseUrlConsistentWithActive: saved.length === 1 && same(saved[0], active, "DATABASE_URL"),
    restartPathConsistentWithActive: saved.length === 1 &&
      path.resolve(saved[0].pm_cwd || "") === api &&
      path.resolve(saved[0].pm_cwd || "", saved[0].pm_exec_path || "") ===
        path.resolve(api, active.pm_exec_path),
  };
} catch {
  out.savedDump = { readable: false };
}

for (const file of [path.join(repo, ".env"), path.join(repo, ".env.production"),
  path.join(api, ".env"), path.join(api, ".env.production")]) {
  const fact = { file, exists: fs.existsSync(file) };
  if (fact.exists) {
    try {
      const parsed = parseEnv(fs.readFileSync(file, "utf8"));
      fact.parseable = true;
      fact.databaseUrlPresent = typeof parsed.DATABASE_URL === "string";
      fact.databaseUrlMatchesActive = fact.databaseUrlPresent && hasDb &&
        parsed.DATABASE_URL === active.DATABASE_URL;
    } catch {
      fact.parseable = false;
    }
  }
  out.envFiles.push(fact);
}

if (!out.environment.inheritedDatabaseUrlProven) {
  out.databaseProbeReason = loaderFlags || bundleLoaderMarkers ? "loaderProvenanceObscured" : "activeConfigurationUnconfirmed";
  emit(1);
  return;
}

let client, connectionAttempted = false;
try {
  const dbPackage = path.join(repo, "lib/db/package.json");
  const pkg = JSON.parse(fs.readFileSync(dbPackage, "utf8"));
  if (pkg.name !== "@workspace/db" || !pkg.dependencies?.pg) throw new Error();
  const req = createRequire(dbPackage);
  const { Client } = req("pg");
const original = active.DATABASE_URL;
  const url = new URL(original);
  // Never let this diagnostic shell supply missing PG defaults.
  if (!url.hostname || !url.username || url.pathname.length < 2) throw new Error();
  const host = url.hostname;
  for (const key of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "options"])
    url.searchParams.delete(key);
  let ssl;
  if (host === "localhost" || host === "127.0.0.1" || (host && !host.includes("."))) ssl = false;
  else if (active.DATABASE_SSL_CA?.trim()) {
    const value = active.DATABASE_SSL_CA.trim();
    const ca = value.startsWith("-----BEGIN") ? value :
      fs.readFileSync(path.resolve(api, value), "utf8");
    ssl = { ca, rejectUnauthorized: true };
  } else if (active.DATABASE_SSL_REJECT_UNAUTHORIZED === "false" ||
      host.endsWith(".rds.amazonaws.com")) ssl = { rejectUnauthorized: false };
  else ssl = { rejectUnauthorized: true };
  client = new Client({
    connectionString: url.toString(), ssl, connectionTimeoutMillis: 5000,
    options: "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
  });
  connectionAttempted = true;
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const facts = await client.query(`
    SELECT inet_server_addr()::text AS server_addr,
      to_regclass('public.ema_release_migrations') IS NOT NULL AS ledger,
      ARRAY(SELECT table_name||':'||column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('ema_assessment_submissions','ema_ghl_operations',
          'ema_ghl_attempts','ema_ghl_links','ema_ghl_worker_leases','ema_ghl_mutation_barriers')) AS cols,
      (SELECT count(*)=2 AND bool_and(convalidated AND
        pg_get_expr(conbin,conrelid)='(environment = ANY (ARRAY[''development''::text, ''test''::text, ''production''::text]))')
        FROM pg_constraint WHERE (conrelid=to_regclass('public.ema_ghl_operations') AND conname='ema_ghl_operations_environment_check')
          OR (conrelid=to_regclass('public.ema_ghl_links') AND conname='ema_ghl_links_environment_check')) AS production_checks,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.ema_assessment_submissions')
        AND tgname='ema_snapshot_immutable' AND tgenabled IN ('O','A') AND NOT tgisinternal) AS immutable,
      EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.ema_ghl_opportunity_owner')
        AND indisunique AND indisvalid) AS ownership`);
  const f = facts.rows[0];
  let ledgerHashes = [];
  if (f.ledger) {
    const ledger = await client.query(`SELECT name,sha256 FROM public.ema_release_migrations
      WHERE name IN ('0001_ema_ghl_outbox.sql','0002_ema_ghl_production.sql')`);
    ledgerHashes = ledger.rows.map(x => `${x.name}:${x.sha256}`);
  }
  await client.query("ROLLBACK");
  // Configuration and archiver counters are NOT evidence of a usable backup.
  out.backup = { recoverableBackupVerified: false, catalogReadable: false };
  try {
    const backup = await client.query(`
      SELECT pg_is_in_recovery() AS in_recovery,
        (SELECT setting IN ('on','always') FROM pg_settings WHERE name='archive_mode') AS archiving_enabled,
        (SELECT setting IN ('replica','logical') FROM pg_settings WHERE name='wal_level') AS wal_level_supports_pitr,
        (SELECT bool_or(length(trim(setting)) > 0) FROM pg_settings
          WHERE name IN ('archive_command','archive_library')) AS archive_handler_configured,
        archived_count, last_archived_time, failed_count, last_failed_time
      FROM pg_stat_archiver`);
    out.backup = { recoverableBackupVerified: false, catalogReadable: true,
      ...backup.rows[0], note: "Settings/counters only; backup destination, retention, restore access and PITR coverage remain unverified." };
  } catch {
    out.backup.note = "Backup catalog unavailable; no backup or recovery capability inferred.";
  }
  const required = {
    ema_assessment_submissions: ["id","lead_id","flow","answers","attribution","captured_at","completed_at"],
    ema_ghl_operations: ["id","submission_id","environment","location_id","kind","ordinal","state","attempts","available_at","lease_token","lease_until","remote_id","result","error_code","confirmed_at"],
    ema_ghl_attempts: ["id","operation_id","action","started_at","finished_at","outcome","http_status","error_code"],
    ema_ghl_links: ["environment","location_id","lead_id","contact_id","opportunity_id","latest_completed_at"],
    ema_ghl_worker_leases: ["scope","token","expires_at"],
    ema_ghl_mutation_barriers: ["scope","operation_id","action","created_at"],
  };
  const cols = new Set(f.cols);
  const hashes = new Set(ledgerHashes);
  const loopback = f.server_addr === "127.0.0.1" || f.server_addr === "::1";
  const localAddresses = new Set(Object.values(os.networkInterfaces()).flat()
    .filter(Boolean).map(x => x.address));
  out.databaseProbe = "completed";
  out.database = {
    locality: !f.server_addr || loopback ? "unknown" : localAddresses.has(f.server_addr) ? "local" : "remote",
    loopbackMayBeTunnel: loopback,
    ledgerPresent: f.ledger,
    ledgerHashesMatchCandidate: f.ledger && [...expected].every(([n, h]) => hashes.has(`${n}:${h}`)),
    migrations: Object.fromEntries([...expected].map(([n,h]) => [n,
      hashes.has(`${n}:${h}`) ? "matches-candidate" :
      ledgerHashes.some(x=>x.startsWith(n+":")) ? "hash-mismatch" : "not-recorded"])),
    tablesPresent: Object.fromEntries(Object.keys(required).map(t=>[t,[...cols].some(c=>c.startsWith(t+":"))])),
    requiredColumnsPresent: Object.entries(required).every(([t, cs]) => cs.every(c => cols.has(`${t}:${c}`))),
    productionEnvironmentChecksValid: f.production_checks,
    immutableTriggerValid: f.immutable,
    ownershipIndexValid: f.ownership,
  };
  out.ok = true; // Successful read-only probe; false readiness facts are actionable results.
  emit();
} catch {
  try { if (client) await client.query("ROLLBACK"); } catch {}
  out.databaseProbe = connectionAttempted ? "failed" : "stopped";
  out.databaseError = connectionAttempted ? "redactedConnectionOrCatalogFailure" :
    "exactConfigurationOrLocalDependencyUnavailable";
  emit(1);
} finally {
  try { if (client) await client.end(); } catch {}
}
})().catch(() => {
  console.log('{"ok":false,"stage":"unexpected","databaseProbe":"stopped"}');
  process.exitCode = 1;
});
NODE
)