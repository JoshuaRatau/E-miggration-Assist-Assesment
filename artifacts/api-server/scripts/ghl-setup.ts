import { pathToFileURL } from "node:url";
import {
  expectedProviderFieldKey,
  fieldDefinitions,
  providerFieldKeyMatches,
  type FieldDefinition,
} from "../src/lib/ghl/fields";
import { controlledConfig, preflightControlled } from "../src/lib/ghl/controlled";
import { HttpGhlClient } from "../src/lib/ghl/client";
import { decodeRemoteFieldOptions } from "../src/lib/ghl/field-options";

type Environment = Record<string, string | undefined>;
type RemoteField = { id: string; name: string; fieldKey: string; dataType: string; model: string; options?: string[]; picklistOptions?: string[] };
export type SetupDependencies = {
  env?: Environment;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onCreated?: (mapping: { logicalMappingKey: string; id: string }) => void;
};
export class SetupError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new SetupError(code); }
const identifier = /^[a-zA-Z0-9_-]+$/;
const logical = (f: FieldDefinition) => `${f.model}.${f.key}`;
const protectedKeys = new Set([
  "contact.work_email", "contact.biggest_challenge", "contact.visa_services_managed",
  "contact.job_title", "contact.work_phone_number", "contact.monthly_case_volume",
  "contact.organization_type", "contact.solution_timeline",
]);
const protectedIds = new Set([
  "2iOXERu2s46l8kMCBiHz", "IS2CAXTma2xz9o3EMjfp", "KpOR1mtq9Si0pRhkrr01",
  "RtXtcvdzU42voJDLm9qS", "gZtaUo0SSLXhQcJAGJ77", "ojsDWQfgXKvIZrKW0Uur",
  "orEkAgxqn2IMek7lhmHS", "qGcf3BK7GKqMpJ6ZqKzc",
]);
export const setupUsage = "Default: --dry-run (alias --plan). Apply: --apply --location-id ID --approve-location ID [--reuse contact.ema_lead_id=FIELD_ID ...]. Requires NODE_ENV=development|test, EMA_GHL_SETUP_ENABLED=true, GHL_LOCATION_ID=ID, EMA_GHL_TEST_LOCATION_ID=ID and GHL_PRIVATE_INTEGRATION_TOKEN. Controlled LIVE account: additionally specify --controlled-live-account, matching EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID, manifest/three-record approval and EMA_GHL_CONTROLLED_SETUP_APPROVAL=ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT; this replaces only the separate test-location check. To create only the 22 field definitions without the controlled contact preflight, additionally specify --fields-only; it is valid only with --controlled-live-account and retains all other controlled setup and location approvals. All six identities must preflight empty before fields are created unless --fields-only is specified. Reuse explicitly approves semantic purpose, not just a matching name.";

function parse(args: string[]) {
  let apply = false, dry = false, help = false, controlledLive = false, fieldsOnly = false, location: string | undefined, approval: string | undefined;
  const reuse = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") { if (apply) fail("DUPLICATE_ARGUMENT"); apply = true; }
    else if (arg === "--dry-run" || arg === "--plan") dry = true;
    else if (arg === "--help") help = true;
    else if (arg === "--controlled-live-account") controlledLive = true;
    else if (arg === "--fields-only") { if (fieldsOnly) fail("DUPLICATE_ARGUMENT"); fieldsOnly = true; }
    else if (["--location-id", "--approve-location", "--reuse"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail("ARGUMENT_VALUE_REQUIRED");
      if (arg === "--location-id") { if (location) fail("DUPLICATE_ARGUMENT"); location = value; }
      else if (arg === "--approve-location") { if (approval) fail("DUPLICATE_ARGUMENT"); approval = value; }
      else {
        const parts = value.split("=");
        if (parts.length !== 2 || !fieldDefinitions.some(f => logical(f) === parts[0]) ||
          !identifier.test(parts[1]) || reuse.has(parts[0])) fail("INVALID_REUSE_APPROVAL");
        reuse.set(parts[0], parts[1]);
      }
    } else fail("UNKNOWN_ARGUMENT");
  }
  if (apply && (dry || help)) fail("CONFLICTING_MODES");
  if (fieldsOnly && !controlledLive) fail("FIELDS_ONLY_REQUIRES_CONTROLLED_LIVE_ACCOUNT");
  return { apply, help, location, approval, reuse, controlledLive, fieldsOnly };
}

function remote(value: unknown): RemoteField {
  if (!value || typeof value !== "object") return fail("INVALID_FIELD_RESPONSE");
  const f = value as RemoteField;
  const decodedOptions = decodeRemoteFieldOptions(f);
  if (![f.id, f.name, f.fieldKey, f.dataType, f.model].every(v => typeof v === "string" && v.length > 0) ||
    !identifier.test(f.id) || !["contact", "opportunity"].includes(f.model) ||
    !decodedOptions.valid)
    return fail("INVALID_FIELD_RESPONSE");
  return { ...f, options: decodedOptions.values };
}
function compatible(f: RemoteField, d: FieldDefinition) {
  return f.name === d.name && providerFieldKeyMatches(f.fieldKey, d) && f.model === d.model &&
    f.dataType === d.dataType &&
    JSON.stringify([...(f.options ?? [])].sort()) === JSON.stringify([...(d.options ?? [])].sort());
}

/** Importing this module is inert. All destination/approval gates precede any network call. */
export async function runGhlSetup(args: string[] = [], deps: SetupDependencies = {}) {
  const options = parse(args);
  if (options.help) return { mode: "help", instructions: setupUsage };
  if (!options.apply) return {
    mode: "dry-run", destinationType: options.controlledLive ? "controlled-live-account" : "separate-test-account", version: "v3", networkCalls: 0,
    instructions: setupUsage,
    definitions: fieldDefinitions.map(({ key, ...requestBody }) => ({
      logicalMappingKey: `${requestBody.model}.${key}`, requestBody,
    })),
  };
  const env = deps.env ?? process.env;
  if (!["development", "test"].includes(env.NODE_ENV ?? "")) fail("ISOLATED_ENVIRONMENT_REQUIRED");
  if (env.EMA_GHL_SETUP_ENABLED !== "true") fail("SETUP_DISABLED");
  const location = options.location;
  if (!location || !identifier.test(location) || location !== options.approval ||
    location !== env.GHL_LOCATION_ID || (!options.controlledLive && location !== env.EMA_GHL_TEST_LOCATION_ID))
    fail("DESTINATION_APPROVAL_REQUIRED");
  const token = env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token || /[\r\n]/.test(token)) fail("TOKEN_REQUIRED");
  if (new Set(options.reuse.values()).size !== options.reuse.size ||
    [...options.reuse.values()].some(id => protectedIds.has(id))) fail("INVALID_REUSE_APPROVAL");
  if (options.controlledLive) {
    if (env.EMA_GHL_CONTROLLED_SETUP_APPROVAL !== "ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT")
      fail("CONTROLLED_SETUP_APPROVAL_REQUIRED");
    if (env.EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID !== location)
      fail("CONTROLLED_LIVE_APPROVAL_REQUIRED");
    if (!options.fieldsOnly) {
      const controlled = controlledConfig(env, location);
      const readClient = new HttpGhlClient({ enabled: true, allowWrites: false, environment: env.NODE_ENV as "test" | "development",
        locationId: location, approvedLocationId: location, getToken: () => token, fetch: deps.fetch, timeoutMs: deps.timeoutMs });
      await preflightControlled({ environment: env.NODE_ENV as "test" | "development", locationId: location, fieldIds: {}, controlled }, readClient);
    }
  }

  const transport = deps.fetch ?? globalThis.fetch;
  const endpoint = `https://services.leadconnectorhq.com/locations/${encodeURIComponent(location)}/customFields`;
  const request = async (method: "GET" | "POST", suffix = "", body?: unknown): Promise<any> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        transport(endpoint + suffix, {
          method, redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }).then(async response => {
          if (!response.ok) fail(`GHL_HTTP_${response.status}`);
          try { return await response.json(); } catch { return fail("INVALID_JSON_RESPONSE"); }
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          controller.abort();
          reject(new SetupError(method === "POST" ? "CREATE_OUTCOME_UNKNOWN_REVIEW_REQUIRED" : "READ_TIMEOUT"));
        }, deps.timeoutMs ?? 15000); }),
      ]);
      return response;
    } catch (error) {
      if (error instanceof SetupError) throw error;
      return fail(method === "POST" ? "CREATE_OUTCOME_UNKNOWN_REVIEW_REQUIRED" : "READ_NETWORK_FAILURE");
    } finally { if (timer) clearTimeout(timer); }
  };
  // Full preflight before the first POST. No updates/deletes, including protected fields.
  const existing: RemoteField[] = [];
  for (const model of ["contact", "opportunity"]) {
    const data = await request("GET", `?model=${model}`);
    if (!data || !Array.isArray(data.customFields)) fail("INVALID_FIELDS_RESPONSE");
    for (const value of data.customFields) {
      const f = remote(value);
      if (f.model !== model || existing.some(x => x.id === f.id)) fail("INVALID_FIELDS_RESPONSE");
      existing.push(f);
    }
  }
  const plan = fieldDefinitions.map(d => {
    const approval = options.reuse.get(logical(d));
    const collisions = existing.filter(f => f.model === d.model &&
      ([logical(d), expectedProviderFieldKey(d)].some(key => f.fieldKey.toLowerCase() === key.toLowerCase()) ||
        f.name.trim().toLowerCase() === d.name.toLowerCase()));
    if (approval) {
      const f = existing.find(x => x.id === approval);
      if (!f || protectedKeys.has(f.fieldKey) || !compatible(f, d) ||
        collisions.length !== 1 || collisions[0].id !== f.id) fail("REUSE_INCOMPATIBLE");
      return { definition: d, id: f.id };
    }
    if (collisions.length) fail("FIELD_COLLISION_REQUIRES_EXPLICIT_REUSE_APPROVAL");
    return { definition: d, id: undefined };
  });
  const mappings: Record<string, string> = {};
  for (const item of plan) {
    const key = logical(item.definition);
    if (item.id) { mappings[key] = item.id; continue; }
    const { key: _key, ...body } = item.definition;
    const data = await request("POST", "", body);
    const created = remote(data?.customField);
    if (!compatible(created, item.definition) || existing.some(f => f.id === created.id) ||
      Object.values(mappings).includes(created.id)) fail("CREATED_FIELD_REVIEW_REQUIRED");
    mappings[key] = created.id;
    // Persist this safe output: a later failure does not undo already-created fields.
    deps.onCreated?.({ logicalMappingKey: key, id: created.id });
  }
  return { mode: "applied", locationId: location, mappings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGhlSetup(process.argv.slice(2), {
    onCreated: mapping => console.log(JSON.stringify({ created: mapping })),
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error instanceof SetupError ? error.code : "SETUP_FAILED");
    process.exitCode = 1;
  });
}