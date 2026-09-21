"use strict";

const assert = require("node:assert/strict");
const {
  API, FIELD_KEYS, LOCATION, PIPELINE, STAGE, OperatorError, clearControlled, main, mappingSha256,
  validateControlledReport, validateMapping, validateRecipientEvidence,
} = require("./ema-pm2-ghl.cjs");

const now = Date.parse("2026-01-01T00:10:00.000Z");
const mapping = Object.fromEntries(FIELD_KEYS.map((key, index) => [key, `field_${index}`]));
const report = {
  mode: "executed", reportVersion: 1, destinationApproved: true,
  locationId: LOCATION, pipelineId: PIPELINE, stageId: STAGE,
  fieldMappingSha256: mappingSha256(mapping), completedAt: "2025-12-01T00:00:00.000Z",
  isolation: "fresh-in-memory-no-network",
  databaseIsolation: "fresh-in-memory-pglite-no-network-database",
  providerTransport: "live-ghl-http",
  providerReadback: { contacts: 1, notes: 3, opportunities: 3 },
  providerIds: { contactId: "actual-contact", opportunityIds: ["actual-1", "actual-2", "actual-3"] },
  operationsConfirmed: 18, replay: "no-op-verified", piiIncluded: false,
};
const evidence = {
  version: 1, locationId: LOCATION, reviewedAt: "2026-01-01T00:00:00.000Z",
  statement: "REACHABLE_AUTOMATIONS_REVIEWED_OTHER_RECIPIENTS_EXCLUDED_DND_PRESERVED",
  reachableAutomationsReviewed: true, otherRecipientsExcluded: true,
  boundedIdentityOnly: true, suppressionAndDndPreserved: true,
};
const active = {
  name: "immigration-api", pm_exec_path: `${API}/dist/index.mjs`, NODE_ENV: "production",
  DATABASE_URL: "postgres://secret", GHL_PRIVATE_INTEGRATION_TOKEN: "secret-token",
  KEEP_ME: "preserved", EMA_GHL_CONTROLLED_MANIFEST_JSON: "secret-controlled-value",
};

function mockFs(files = {}, procEnv = active) {
  return {
    lstatSync() {
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => true,
      };
    },
    readdirSync(value) {
      assert.equal(value, "/home/ubuntu/.pm2/pids");
      return ["immigration-api-0.pid", "unrelated.pid"];
    },
    readlinkSync(value) {
      assert.equal(value, "/proc/321/cwd");
      return API;
    },
    readFileSync(value) {
      if (value.endsWith(".pid")) return "321";
      if (value === "/proc/321/environ")
        return Object.entries(procEnv).map(([key, item]) => `${key}=${item}`).join("\0");
      if (Object.hasOwn(files, value)) return JSON.stringify(files[value]);
      throw new Error("unexpected path");
    },
  };
}

assert.deepEqual(validateMapping(mapping), mapping);
assert.throws(() => validateMapping({ ...mapping, extra: "field_extra" }),
  error => error instanceof OperatorError && error.code === "MAPPING_KEYS_INVALID");
validateControlledReport(report, mapping);
assert.throws(() => validateControlledReport({ ...report, mode: "dry-run" }, mapping),
  error => error.code === "CONTROLLED_SUCCESS_REPORT_REQUIRED");
assert.throws(() => validateControlledReport({ ...report, locationId: "other" }, mapping),
  error => error.code === "CONTROLLED_SUCCESS_REPORT_REQUIRED");
assert.throws(() => validateControlledReport(report, { ...mapping, [FIELD_KEYS[0]]: "changed" }),
  error => error.code === "CONTROLLED_SUCCESS_REPORT_REQUIRED");
assert.throws(() => validateControlledReport({
  ...report,
  providerIds: { ...report.providerIds, opportunityIds: ["actual-1", "actual-1", "actual-3"] },
}, mapping), error => error.code === "CONTROLLED_SUCCESS_REPORT_REQUIRED");
validateRecipientEvidence(evidence, now);
assert.throws(() => validateRecipientEvidence({ ...evidence, email: "forbidden" }, now),
  error => error.code === "RECIPIENT_EVIDENCE_CONTAINS_PII");
assert.equal(clearControlled(active).KEEP_ME, "preserved");
assert.equal(clearControlled(active).EMA_GHL_CONTROLLED_MANIFEST_JSON, "");
assert.equal(clearControlled(active).EMA_GHL_CONTROLLED_SETUP_APPROVAL, "");
assert.equal(clearControlled(active).EMA_GHL_SETUP_ENABLED, "false");

{
  const calls = [];
  const result = main(["migrate"], {
    fs: mockFs(),
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { ok: true, mode: "migrate" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [`${API}/dist/ema-migrate.mjs`, "--apply"]);
  assert.equal(calls[0].options.env.EMA_APPLY_MIGRATIONS, "approved");
  assert.equal(calls[0].options.env.DATABASE_URL, "postgres://secret");
}

{
  const calls = [];
  main(["disable"], {
    fs: mockFs(),
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["restart", "immigration-api", "--update-env"]);
  assert.equal(calls[0].options.env.EMA_GHL_CAPTURE_ENABLED, "false");
  assert.equal(calls[0].options.env.EMA_GHL_DELIVERY_ENABLED, "false");
  assert.equal(calls[0].options.env.KEEP_ME, "preserved");
  assert.equal(calls[0].options.env.EMA_GHL_CONTROLLED_MANIFEST_JSON, "");
  assert.equal({ ...active, ...calls[0].options.env }.EMA_GHL_CONTROLLED_MANIFEST_JSON, "");
}

assert.throws(() => main(["migrate"], {
  fs: mockFs({}, { ...active, EMA_GHL_DELIVERY_ENABLED: "true" }),
  spawnSync() { throw new Error("must not spawn"); },
}), error => error.code === "COLD_MIGRATION_REQUIRED");

{
  const calls = [], files = {
    "/review/mapping.json": mapping,
    "/review/report.json": report,
    "/review/evidence.json": evidence,
  };
  main(["enable", "--mapping", "/review/mapping.json", "--controlled-report",
    "/review/report.json", "--recipient-evidence", "/review/evidence.json"], {
    fs: mockFs(files), now: () => now,
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [`${API}/dist/ghl-production-check.mjs`]);
  assert.deepEqual(calls[1].args, ["restart", "immigration-api", "--update-env"]);
  assert.equal(calls[1].options.env.GHL_LOCATION_ID, LOCATION);
  assert.equal(calls[1].options.env.EMA_GHL_DELIVERY_MODE, "production");
  assert.equal(calls[1].options.env.KEEP_ME, "preserved");
}

process.stdout.write("PASS ema-pm2-ghl isolated operator helper tests\n");