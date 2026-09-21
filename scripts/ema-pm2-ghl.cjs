"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { createHash } = require("node:crypto");

const API = "/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server";
const PROCESS = "immigration-api";
const LOCATION = "5ce9hy8I0qH6fFNBo1cF";
const PIPELINE = "gXmKkxDwNOTZnpG6AUgD";
const STAGE = "7115d545-87ab-4f8b-b8f9-69a0a8464d26";
const RECIPIENT_STATEMENT =
  "REACHABLE_AUTOMATIONS_REVIEWED_OTHER_RECIPIENTS_EXCLUDED_DND_PRESERVED";
const FIELD_KEYS = [
  "contact.ema_lead_id", "contact.ema_reference", "contact.ema_latest_submission_id",
  "contact.ema_assessment_type", "contact.ema_latest_completed_at",
  "contact.ema_assessment_consent", "contact.ema_consent_at",
  "contact.ema_preferred_contact_channel", "contact.ema_whatsapp_number",
  "contact.ema_whatsapp_opt_in", "contact.ema_source", "contact.ema_source_campaign",
  "contact.ema_utm_source", "contact.ema_utm_medium", "contact.ema_utm_campaign",
  "contact.ema_funnel_context", "contact.ema_immigration_situation",
  "contact.ema_overstay_situation", "contact.ema_practice_areas",
  "contact.ema_annual_case_volume_band", "opportunity.ema_lead_id",
  "opportunity.ema_reference",
];
const CONTROLLED_VARIABLES = [
  "EMA_GHL_CONTROLLED_LIVE_APPROVAL",
  "EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID",
  "EMA_GHL_CONTROLLED_MANIFEST_JSON",
  "EMA_GHL_TEST_LOCATION_ID",
  "EMA_GHL_APPROVED_TEST_LOCATION_ID",
  "EMA_GHL_APPROVED_TEST_LOCATION",
  "EMA_GHL_DELIVERY_APPROVAL",
  "EMA_GHL_CONTROLLED_SETUP_APPROVAL",
];

class OperatorError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const ensure = (value, code) => { if (!value) throw new OperatorError(code); };

function parseProcEnvironment(raw) {
  const entries = raw.split("\0").filter(Boolean).map(value => {
    const separator = value.indexOf("=");
    ensure(separator > 0, "ACTIVE_ENV_INVALID");
    return [value.slice(0, separator), value.slice(separator + 1)];
  });
  return Object.fromEntries(entries);
}

function readActiveEnvironment(io = fs) {
  const matches = [];
  for (const file of io.readdirSync("/home/ubuntu/.pm2/pids")) {
    if (!/^immigration-api-\d+\.pid$/.test(file)) continue;
    try {
      const pid = io.readFileSync(path.join("/home/ubuntu/.pm2/pids", file), "utf8").trim();
      if (!/^[1-9]\d*$/.test(pid)) continue;
      const env = parseProcEnvironment(io.readFileSync(`/proc/${pid}/environ`, "utf8"));
      if (io.readlinkSync(`/proc/${pid}/cwd`) === API &&
          env.name === PROCESS && env.pm_exec_path === `${API}/dist/index.mjs`)
        matches.push({ pid, env });
    } catch {
      // A disappearing or unreadable process is not an active verified match.
    }
  }
  ensure(matches.length === 1, "ACTIVE_PROCESS_NOT_UNIQUE");
  ensure(matches[0].env.NODE_ENV === "production", "ACTIVE_ENV_NOT_PRODUCTION");
  return matches[0].env;
}

function validateDeploymentPaths(mode, io = fs) {
  const required = [
    [API, "directory"],
    [`${API}/dist`, "directory"],
    [`${API}/dist/${mode === "migrate" ? "ema-migrate.mjs" : mode === "enable" ? "ghl-production-check.mjs" : "index.mjs"}`, "file"],
  ];
  for (const [entry, kind] of required) {
    let stat;
    try { stat = io.lstatSync(entry); } catch { throw new OperatorError("DEPLOYMENT_PATH_INVALID"); }
    ensure(!stat.isSymbolicLink() &&
      (kind === "directory" ? stat.isDirectory() : stat.isFile()), "DEPLOYMENT_PATH_INVALID");
  }
}

function readJsonFile(file, io = fs) {
  ensure(typeof file === "string" && file.length > 0 && path.isAbsolute(file), "ABSOLUTE_FILE_REQUIRED");
  try { return JSON.parse(io.readFileSync(file, "utf8")); }
  catch { throw new OperatorError("JSON_FILE_INVALID"); }
}

function validateMapping(value) {
  ensure(value && typeof value === "object" && !Array.isArray(value), "MAPPING_INVALID");
  const keys = Object.keys(value).sort();
  ensure(keys.length === FIELD_KEYS.length &&
    keys.every((key, index) => key === [...FIELD_KEYS].sort()[index]), "MAPPING_KEYS_INVALID");
  const ids = Object.values(value);
  ensure(ids.every(id => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)), "MAPPING_ID_INVALID");
  ensure(new Set(ids).size === ids.length, "MAPPING_ID_DUPLICATE");
  return value;
}

function mappingSha256(mapping) {
  const sorted = Object.fromEntries(Object.entries(mapping)
    .sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function validateControlledReport(value, mapping) {
  const completedAt = Date.parse(value?.completedAt);
  const providerIds = value?.providerIds;
  ensure(value && value.mode === "executed" && value.reportVersion === 1 &&
    value.destinationApproved === true &&
    value.locationId === LOCATION && value.pipelineId === PIPELINE && value.stageId === STAGE &&
    value.fieldMappingSha256 === mappingSha256(mapping) && Number.isFinite(completedAt) &&
    value.isolation === "fresh-in-memory-no-network" &&
    value.databaseIsolation === "fresh-in-memory-pglite-no-network-database" &&
    value.providerTransport === "live-ghl-http" &&
    value.providerReadback?.contacts === 1 && value.providerReadback?.notes === 3 &&
    value.providerReadback?.opportunities === 3 && value.operationsConfirmed === 18 &&
    typeof providerIds?.contactId === "string" && providerIds.contactId.length > 0 &&
    Array.isArray(providerIds?.opportunityIds) && providerIds.opportunityIds.length === 3 &&
    providerIds.opportunityIds.every(id => typeof id === "string" && id.length > 0) &&
    new Set(providerIds.opportunityIds).size === 3 &&
    value.replay === "no-op-verified" && value.piiIncluded === false,
  "CONTROLLED_SUCCESS_REPORT_REQUIRED");
}

function validateRecipientEvidence(value, now = Date.now()) {
  const reviewed = Date.parse(value?.reviewedAt);
  const age = now - reviewed;
  ensure(value?.version === 1 && value.locationId === LOCATION &&
    value.statement === RECIPIENT_STATEMENT &&
    value.reachableAutomationsReviewed === true && value.otherRecipientsExcluded === true &&
    value.boundedIdentityOnly === true && value.suppressionAndDndPreserved === true &&
    Number.isFinite(reviewed) && age >= -5 * 60_000 && age <= 30 * 60_000,
  "RECIPIENT_EVIDENCE_INVALID");
  ensure(!Object.keys(value).some(key => /email|phone|whatsapp/i.test(key)),
    "RECIPIENT_EVIDENCE_CONTAINS_PII");
}

function parseArgs(argv) {
  const mode = argv[0];
  ensure(["migrate", "disable", "enable"].includes(mode), "USAGE");
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    ensure(["--mapping", "--controlled-report", "--recipient-evidence"].includes(flag) &&
      value && !value.startsWith("--") && !Object.hasOwn(options, flag), "USAGE");
    options[flag] = value;
  }
  if (mode === "enable")
    ensure(options["--mapping"] && options["--controlled-report"] &&
      options["--recipient-evidence"] && Object.keys(options).length === 3, "ENABLE_INPUTS_REQUIRED");
  else ensure(Object.keys(options).length === 0, "USAGE");
  return { mode, options };
}

function clearControlled(env) {
  const result = { ...env };
  // PM2 --update-env merges rather than replaces its saved process environment.
  // Explicit empty values ensure stale controlled/test approvals are overwritten.
  for (const key of CONTROLLED_VARIABLES) result[key] = "";
  result.EMA_GHL_SETUP_ENABLED = "false";
  return result;
}

function run(command, args, env, spawn = childProcess.spawnSync) {
  const result = spawn(command, args, { cwd: API, env, stdio: "inherit" });
  ensure(!result.error && result.status === 0, "COMMAND_FAILED");
}

function main(argv = process.argv.slice(2), deps = {}) {
  const io = deps.fs ?? fs;
  const spawn = deps.spawnSync ?? childProcess.spawnSync;
  const { mode, options } = parseArgs(argv);
  validateDeploymentPaths(mode, io);
  const active = readActiveEnvironment(io);
  ensure(!active.NODE_OPTIONS && !active.NODE_PATH, "LOADER_ENV_DENIED");
  ensure(!/--env-file|--require|--import|(?:^|\s)-r(?:\s|$)/.test(active.node_args || ""),
    "LOADER_FLAGS_DENIED");

  if (mode === "migrate") {
    ensure(active.EMA_GHL_CAPTURE_ENABLED !== "true" &&
      active.EMA_GHL_DELIVERY_ENABLED !== "true", "COLD_MIGRATION_REQUIRED");
    run("/usr/bin/node", [`${API}/dist/ema-migrate.mjs`, "--apply"],
      { ...active, EMA_APPLY_MIGRATIONS: "approved" }, spawn);
    return { ok: true, mode };
  }

  let next = clearControlled(active);
  if (mode === "disable") {
    next.EMA_GHL_CAPTURE_ENABLED = "false";
    next.EMA_GHL_DELIVERY_ENABLED = "false";
  } else {
    const mapping = validateMapping(readJsonFile(options["--mapping"], io));
    validateControlledReport(readJsonFile(options["--controlled-report"], io), mapping);
    validateRecipientEvidence(readJsonFile(options["--recipient-evidence"], io), deps.now?.() ?? Date.now());
    ensure(next.DATABASE_URL && next.GHL_PRIVATE_INTEGRATION_TOKEN, "ACTIVE_CREDENTIALS_REQUIRED");
    Object.assign(next, {
      EMA_GHL_CAPTURE_ENABLED: "true",
      EMA_GHL_DELIVERY_ENABLED: "true",
      EMA_GHL_DELIVERY_MODE: "production",
      EMA_GHL_PRODUCTION_CAPTURE_APPROVAL: "ALLOW_PRODUCTION_CAPTURE",
      EMA_GHL_PRODUCTION_DELIVERY_APPROVAL: "ALLOW_PRODUCTION_DELIVERY",
      EMA_GHL_PRODUCTION_SCHEMA_APPROVAL: "ALLOW_PRODUCTION_SCHEMA_V2",
      GHL_LOCATION_ID: LOCATION,
      EMA_GHL_APPROVED_PRODUCTION_LOCATION_ID: LOCATION,
      EMA_GHL_PIPELINE_ID: PIPELINE,
      EMA_GHL_STAGE_ID: STAGE,
      EMA_GHL_FIELD_IDS_JSON: JSON.stringify(mapping),
    });
    run("/usr/bin/node", [`${API}/dist/ghl-production-check.mjs`], next, spawn);
  }
  run("pm2", ["restart", PROCESS, "--update-env"], next, spawn);
  return { ok: true, mode };
}

if (require.main === module) {
  try {
    const result = main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof OperatorError ? error.code : "OPERATOR_HELPER_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  API, FIELD_KEYS, LOCATION, PIPELINE, STAGE, OperatorError, clearControlled, main, mappingSha256,
  parseArgs, parseProcEnvironment, readActiveEnvironment, validateControlledReport,
  validateDeploymentPaths, validateMapping, validateRecipientEvidence,
};