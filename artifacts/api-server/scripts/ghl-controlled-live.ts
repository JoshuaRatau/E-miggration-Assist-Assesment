import { createHash } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { deliveryConfig, GhlFailure, type GhlConfig, type GhlEnvironment } from "../src/lib/ghl/config";
import { HttpGhlClient, type GhlClient } from "../src/lib/ghl/client";
import { fieldDefinitions } from "../src/lib/ghl/fields";
import {
  createControlledRun,
  finalizeControlledFixture,
  preflightControlled,
  saveControlledFixture,
  type ControlledManifest,
} from "../src/lib/ghl/controlled";
import { GhlWorker } from "../src/lib/ghl/worker";

const approvedRecords = [
  ["individual", "843b5cf4-456c-46cd-87e5-50f6d9cc1a4f", "2a2f7b63-f30c-4f20-8ceb-4662ff024dcd"],
  ["overstay", "856c18fe-962a-45e2-b457-88ab2f4a20cb", "f0cf5621-8084-4088-9830-4a0f763a0128"],
  ["business", "7eb4be34-7b67-4c28-8dd7-df02cef5fd1a", "6289f8e1-adbc-49a3-844b-50ea6fd98b40"],
] as const;
const recipientStatement =
  "REACHABLE_AUTOMATIONS_REVIEWED_OTHER_RECIPIENTS_EXCLUDED_DND_PRESERVED";

export const controlledLiveUsage = [
  "Default: --dry-run (network-free). Live execution: --execute --approve-location ID --recipient-evidence FILE.",
  "Execution additionally requires the existing controlled-live delivery environment contract, the exact three approved UUID pairs, one normalized shared email/E.164 phone, a complete 22-field mapping, and a token.",
  `Evidence JSON must contain version=1, matching locationId, a reviewedAt timestamp no more than 30 minutes old, statement="${recipientStatement}", and true values for reachableAutomationsReviewed, otherRecipientsExcluded, boundedIdentityOnly, suppressionAndDndPreserved.`,
  "Do not put recipient email or phone in the evidence file or command line. Identity is accepted only inside EMA_GHL_CONTROLLED_MANIFEST_JSON.",
].join(" ");

type Environment = GhlEnvironment;
type Evidence = {
  version: number;
  locationId: string;
  reviewedAt: string;
  statement: string;
  reachableAutomationsReviewed: boolean;
  otherRecipientsExcluded: boolean;
  boundedIdentityOnly: boolean;
  suppressionAndDndPreserved: boolean;
};
export type ControlledLiveDependencies = {
  env?: Environment;
  fetch?: typeof fetch;
  readFile?: (path: string) => Promise<string>;
  now?: () => number;
  timeoutMs?: number;
};

export class ControlledLiveCliError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new ControlledLiveCliError(code); };
const identifier = /^[A-Za-z0-9_-]+$/;

function parseArgs(args: string[]) {
  let execute = false, dryRun = false, help = false;
  let location: string | undefined, evidencePath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") {
      if (execute) fail("DUPLICATE_ARGUMENT");
      execute = true;
    } else if (arg === "--dry-run" || arg === "--plan") dryRun = true;
    else if (arg === "--help") help = true;
    else if (arg === "--approve-location" || arg === "--recipient-evidence") {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail("ARGUMENT_VALUE_REQUIRED");
      if (arg === "--approve-location") {
        if (location) fail("DUPLICATE_ARGUMENT");
        location = value;
      } else {
        if (evidencePath) fail("DUPLICATE_ARGUMENT");
        evidencePath = value;
      }
    } else fail("UNKNOWN_ARGUMENT");
  }
  if (execute && (dryRun || help)) fail("CONFLICTING_MODES");
  return { execute, help, location, evidencePath };
}

function assertApprovedManifest(manifest: ControlledManifest) {
  if (manifest.records.length !== approvedRecords.length) fail("APPROVED_MANIFEST_REQUIRED");
  for (let i = 0; i < approvedRecords.length; i++) {
    const [flow, leadId, submissionId] = approvedRecords[i];
    const record = manifest.records[i];
    if (record.flow !== flow || record.leadId !== leadId || record.submissionId !== submissionId)
      fail("APPROVED_MANIFEST_REQUIRED");
  }
}

function assertCompleteFieldMapping(config: GhlConfig) {
  const keys = fieldDefinitions.map(field => `${field.model}.${field.key}`);
  if (Object.keys(config.fieldIds).length !== keys.length || keys.some(key => !Object.hasOwn(config.fieldIds, key)))
    fail("COMPLETE_22_FIELD_MAPPING_REQUIRED");
}

export async function readEvidence(path: string, locationId: string, deps: ControlledLiveDependencies = {}) {
  let value: Evidence;
  try {
    value = JSON.parse(await (deps.readFile ?? (async p => readFileFromDisk(p, "utf8")))(path));
  } catch {
    return fail("RECIPIENT_EVIDENCE_INVALID");
  }
  const reviewed = Date.parse(value.reviewedAt);
  const age = (deps.now?.() ?? Date.now()) - reviewed;
  if (value.version !== 1 || value.locationId !== locationId || value.statement !== recipientStatement ||
    value.reachableAutomationsReviewed !== true || value.otherRecipientsExcluded !== true ||
    value.boundedIdentityOnly !== true || value.suppressionAndDndPreserved !== true ||
    !Number.isFinite(reviewed) || age < -5 * 60_000 || age > 30 * 60_000)
    fail("RECIPIENT_EVIDENCE_INVALID");
  // Evidence describes account review only and must not become another PII store.
  const forbidden = ["email", "phone", "whatsapp"];
  if (Object.keys(value).some(key => forbidden.some(word => key.toLowerCase().includes(word))))
    fail("RECIPIENT_EVIDENCE_CONTAINS_PII");
}

async function validateDestination(client: GhlClient, config: GhlConfig) {
  for (const model of ["contact", "opportunity"] as const) {
    const response = await client.request("GET",
      `/locations/${encodeURIComponent(config.locationId)}/customFields?model=${model}`);
    const remote = response.body?.customFields;
    if (!Array.isArray(remote)) fail("CONTROLLED_FIELD_MAPPING_MISMATCH");
    for (const definition of fieldDefinitions.filter(field => field.model === model)) {
      const fields = remote.filter((field: any) => field.id === config.fieldIds[`${model}.${definition.key}`]);
      const field = fields[0];
      if (fields.length !== 1 || field.model !== model || field.fieldKey !== `${model}.${definition.key}` ||
        field.dataType !== definition.dataType ||
        JSON.stringify([...(field.options ?? [])].sort()) !== JSON.stringify([...(definition.options ?? [])].sort()))
        fail("CONTROLLED_FIELD_MAPPING_MISMATCH");
    }
  }
  const response = await client.request("GET",
    `/opportunities/pipelines?locationId=${encodeURIComponent(config.locationId)}`);
  const pipelines = response.body?.pipelines;
  if (!Array.isArray(pipelines) || pipelines.filter((pipeline: any) =>
    pipeline.id === config.pipelineId && Array.isArray(pipeline.stages) &&
    pipeline.stages.some((stage: any) => stage.id === config.stageId)).length !== 1)
    fail("CONTROLLED_PIPELINE_STAGE_MISMATCH");
}

async function auditProvider(client: GhlClient, config: GhlConfig, links: any[]) {
  if (!config.controlled || links.length !== 3) fail("CONTROLLED_AUDIT_FAILED");
  const contactIds = new Set(links.map(link => link.contact_id));
  if (contactIds.size !== 1 || [...contactIds].some(id => typeof id !== "string")) fail("CONTROLLED_AUDIT_FAILED");
  const contactId = links[0].contact_id;
  const contact = (await client.request("GET", `/contacts/${encodeURIComponent(contactId)}`)).body.contact;
  const identity = config.controlled.records[0];
  const latest = config.controlled.records[2];
  const custom = (key: string) => contact.customFields?.find((field: any) =>
    field.id === config.fieldIds[`contact.${key}`])?.value;
  if (contact.locationId !== config.locationId || contact.email?.toLowerCase() !== identity.email ||
    contact.phone !== identity.phone || custom("ema_latest_submission_id") !== latest.submissionId ||
    custom("ema_assessment_type") !== "business")
    fail("CONTROLLED_AUDIT_FAILED");
  const notes = (await client.request("GET", `/contacts/${encodeURIComponent(contactId)}/notes`)).body.notes;
  if (!Array.isArray(notes) || notes.length !== 3 || config.controlled.records.some(record =>
    notes.filter((note: any) => typeof note.body === "string" &&
      note.body.includes(`[ema-submission:${record.submissionId}]`)).length !== 1))
    fail("CONTROLLED_AUDIT_FAILED");
  for (const record of config.controlled.records) {
    const link = links.find(link => link.lead_id === record.leadId);
    if (!link?.opportunity_id) fail("CONTROLLED_AUDIT_FAILED");
    const opportunity = (await client.request("GET",
      `/opportunities/${encodeURIComponent(link.opportunity_id)}`)).body.opportunity;
    const owner = opportunity.customFields?.find((field: any) =>
      field.id === config.fieldIds["opportunity.ema_lead_id"])?.fieldValue;
    if (opportunity.locationId !== config.locationId || opportunity.contactId !== contactId ||
      opportunity.pipelineId !== config.pipelineId || owner !== record.leadId)
      fail("CONTROLLED_AUDIT_FAILED");
  }
}

function safePlan() {
  return {
    mode: "dry-run",
    networkCalls: 0,
    database: "fresh-in-memory-pglite",
    approvedRecords: 3,
    sharedIdentityRequired: true,
    fieldDefinitionsRequired: 22,
    writes: { contacts: 1, contactUpdates: 2, notes: 3, opportunities: 3 },
    requiredInputs: {
      command: ["--execute", "--approve-location ID", "--recipient-evidence FILE"],
      environment: [
        "NODE_ENV=development|test",
        "EMA_GHL_DELIVERY_ENABLED=true",
        "EMA_GHL_DELIVERY_MODE=controlled-live",
        "GHL_LOCATION_ID",
        "EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID",
        "EMA_GHL_CONTROLLED_LIVE_APPROVAL",
        "EMA_GHL_CONTROLLED_MANIFEST_JSON",
        "EMA_GHL_PIPELINE_ID",
        "EMA_GHL_STAGE_ID",
        "EMA_GHL_FIELD_IDS_JSON",
        "GHL_PRIVATE_INTEGRATION_TOKEN",
      ],
    },
    recipientEvidenceTemplate: {
      version: 1,
      locationId: "<approved-location-id>",
      reviewedAt: "<current-UTC-ISO-within-30-minutes>",
      statement: recipientStatement,
      reachableAutomationsReviewed: true,
      otherRecipientsExcluded: true,
      boundedIdentityOnly: true,
      suppressionAndDndPreserved: true,
    },
    safeSuccessReport: {
      providerReadback: ["contacts", "notes", "opportunities"],
      operationsConfirmed: 18,
      replay: "no-op-verified",
      piiIncluded: false,
    },
    instructions: controlledLiveUsage,
  } as const;
}

/** Importing this module is inert. Without --execute it does not read env, files, credentials, DB, or network. */
export async function runControlledLive(args: string[] = [], deps: ControlledLiveDependencies = {}) {
  const options = parseArgs(args);
  if (options.help) return { mode: "help", instructions: controlledLiveUsage };
  if (!options.execute) return safePlan();
  if (!options.location || !identifier.test(options.location) || !options.evidencePath)
    fail("EXECUTION_APPROVAL_ARGUMENTS_REQUIRED");

  const env = deps.env ?? process.env;
  if (env.NODE_ENV === "production") fail("CONTROLLED_PRODUCTION_PROCESS_DENIED");
  if (env.GHL_LOCATION_ID !== options.location ||
    env.EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID !== options.location)
    fail("CONTROLLED_DESTINATION_APPROVAL_REQUIRED");
  const config = deliveryConfig(env);
  if (!config.controlled || config.locationId !== options.location) fail("CONTROLLED_MODE_REQUIRED");
  assertApprovedManifest(config.controlled);
  assertCompleteFieldMapping(config);
  await readEvidence(options.evidencePath, config.locationId, deps);
  const token = env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token || /[\r\n]/.test(token)) fail("TOKEN_REQUIRED");

  const client = new HttpGhlClient({
    enabled: true,
    allowWrites: true,
    environment: config.environment,
    locationId: config.locationId,
    approvedLocationId: options.location,
    getToken: () => token,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
  });
  // Every call before the in-process preflight receipt is read-only.
  await validateDestination(client, config);
  await preflightControlled(config, client);

  const run = await createControlledRun(config);
  const consentTimestamp = new Date(deps.now?.() ?? Date.now()).toISOString();
  for (const record of config.controlled.records) {
    const common = {
      fullName: "EMA Controlled Test",
      email: record.email,
      phone: record.phone,
      whatsapp: record.phone,
      consentAccepted: true,
      consentTimestamp,
      preferredContactMethod: "email",
    };
    const answers = record.flow === "individual"
      ? { ...common, immigrationSituation: "visa_required" }
      : record.flow === "overstay"
        ? { ...common, firstName: "EMA Controlled Test", currentSituation: "unsure_of_status" }
        : { ...common, firmName: "EMA Controlled Test Firm", practiceAreas: ["work_visas"], casesLast12mBand: "<25" };
    await saveControlledFixture(run.db, config, record.submissionId, answers,
      { source: "controlled-test", sourceCampaign: "shared-contact-test" });
    // Individual capture is deliberately deferred; finalise it before the two
    // atomic flows so provider delivery and latest-value ordering stay fixed.
    if (record.flow === "individual")
      await finalizeControlledFixture(run.db, config, record.submissionId);
  }

  const worker = new GhlWorker(run.db, client, config);
  for (let i = 0; i < 18; i++) {
    if (!await worker.tick()) fail("CONTROLLED_DELIVERY_STOPPED_EARLY");
  }
  const operations = await run.pg.query("SELECT state,error_code FROM ema_ghl_operations ORDER BY id");
  if (operations.rows.length !== 18 || operations.rows.some((row: any) => row.state !== "confirmed"))
    fail("CONTROLLED_DELIVERY_NOT_COMPLETE");
  const links = await run.pg.query("SELECT lead_id,contact_id,opportunity_id FROM ema_ghl_links ORDER BY lead_id");
  await auditProvider(client, config, links.rows);
  await run.verifyReplay(worker);
  await run.close();
  const sortedFieldMapping = Object.fromEntries(Object.entries(config.fieldIds)
    .sort(([left], [right]) => left.localeCompare(right)));
  const contactId = links.rows[0]?.contact_id;
  const opportunityIds = config.controlled.records.map(record =>
    links.rows.find((link: any) => link.lead_id === record.leadId)?.opportunity_id);
  if (typeof contactId !== "string" || opportunityIds.some(id => typeof id !== "string"))
    fail("CONTROLLED_AUDIT_FAILED");

  return {
    mode: "executed",
    reportVersion: 1,
    destinationApproved: true,
    locationId: config.locationId,
    pipelineId: config.pipelineId!,
    stageId: config.stageId!,
    fieldMappingSha256: createHash("sha256").update(JSON.stringify(sortedFieldMapping)).digest("hex"),
    completedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
    isolation: "fresh-in-memory-no-network",
    databaseIsolation: "fresh-in-memory-pglite-no-network-database",
    providerTransport: "live-ghl-http",
    manifest: {
      records: 3,
      sharedIdentity: true,
      approvedPairSet: createHash("sha256").update(approvedRecords.flat().join("|")).digest("hex").slice(0, 16),
    },
    providerReadback: { contacts: 1, notes: 3, opportunities: 3 },
    providerIds: { contactId, opportunityIds: opportunityIds as string[] },
    operationsConfirmed: 18,
    replay: "no-op-verified",
    piiIncluded: false,
  } as const;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runControlledLive(process.argv.slice(2)).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    const code = error instanceof ControlledLiveCliError || error instanceof GhlFailure
      ? error.code : "CONTROLLED_LIVE_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code, piiIncluded: false })}\n`);
    process.exitCode = 1;
  });
}