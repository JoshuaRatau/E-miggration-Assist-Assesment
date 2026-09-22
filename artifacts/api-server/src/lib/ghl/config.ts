import { controlledConfig, type ControlledManifest } from "./controlled";
import { fieldDefinitions } from "./fields";
export const operationKinds = ["contact", "contact_verify", "history", "history_verify", "opportunity", "opportunity_verify"] as const;
export type OperationKind = typeof operationKinds[number] | "opportunity_reuse";
export type GhlConfig = {
  environment: "development" | "test" | "production";
  locationId: string;
  pipelineId?: string;
  stageId?: string;
  fieldIds: Record<string, string>;
  controlled?: ControlledManifest;
};

// Capture is separately enabled only AFTER the additive migration is deliberately applied.
// This does NOT enable a network client, worker, setup writes, or production delivery.
export function captureEnabled(env: GhlEnvironment = process.env) {
  return env.EMA_GHL_CAPTURE_ENABLED === "true";
}
export function captureConfig(env: GhlEnvironment = process.env): GhlConfig {
  if (env.NODE_ENV === "production") {
    if (!captureEnabled(env)) throw new GhlFailure("CAPTURE_DISABLED");
    if (env.EMA_GHL_PRODUCTION_CAPTURE_APPROVAL !== "ALLOW_PRODUCTION_CAPTURE")
      throw new GhlFailure("PRODUCTION_CAPTURE_APPROVAL_REQUIRED");
    return productionConfig(env);
  }
  if (!["development", "test"].includes(env.NODE_ENV ?? "")) throw new GhlFailure("TEST_ENVIRONMENT_REQUIRED");
  const locationId = env.EMA_GHL_TEST_LOCATION_ID;
  if (!locationId) throw new Error("EMA_GHL_TEST_LOCATION_ID_REQUIRED");
  return { environment: env.NODE_ENV as "development" | "test", locationId, fieldIds: {} };
}

export class GhlFailure extends Error {
  constructor(
    public code: string,
    public status?: number,
    public retryAfterMs?: number,
    public providerResponse?: Record<string, unknown>,
    public correlation?: ProviderCorrelation,
    public providerFailureReason?: "DUPLICATE_OPPORTUNITY",
    public classificationSource?: "sanitizer:exact-message-allowlist",
  ) { super(code); }
}
export type ProviderCorrelation = {
  id: string;
  source: `response-header:${"x-request-id" | "x-correlation-id"}` | "body.traceId";
};
export type GhlEnvironment = Record<string, string | undefined>;
// Existing customer-owned fields must never be destinations of EMA writes.
export const protectedGhlFieldIds = [
  "2iOXERu2s46l8kMCBiHz", "IS2CAXTma2xz9o3EMjfp", "KpOR1mtq9Si0pRhkrr01",
  "RtXtcvdzU42voJDLm9qS", "gZtaUo0SSLXhQcJAGJ77", "ojsDWQfgXKvIZrKW0Uur",
  "orEkAgxqn2IMek7lhmHS", "qGcf3BK7GKqMpJ6ZqKzc",
] as const;
export function validateFieldMapping(fieldIds: Record<string, string>) {
  const ids = Object.values(fieldIds);
  if (ids.some(id => typeof id !== "string" || !id.trim() || id !== id.trim()))
    throw new GhlFailure("FIELD_MAPPING_REQUIRED");
  if (ids.some(id => (protectedGhlFieldIds as readonly string[]).includes(id)))
    throw new GhlFailure("PROTECTED_FIELD_MAPPING");
  // Includes cross-model collisions: provider field IDs identify one field.
  if (new Set(ids).size !== ids.length) throw new GhlFailure("DUPLICATE_FIELD_MAPPING");
}
export function deliveryEnabled(env: GhlEnvironment = process.env) {
  return env.EMA_GHL_DELIVERY_ENABLED === "true";
}
export function deliveryConfig(env: GhlEnvironment = process.env): GhlConfig {
  if (!deliveryEnabled(env)) throw new GhlFailure("DELIVERY_DISABLED");
  if (env.NODE_ENV === "production") {
    if (env.EMA_GHL_PRODUCTION_DELIVERY_APPROVAL !== "ALLOW_PRODUCTION_DELIVERY")
      throw new GhlFailure("PRODUCTION_DELIVERY_APPROVAL_REQUIRED");
    return productionConfig(env);
  }
  // Production requires a separately reviewed release and schema allowance.
  if (!["development", "test"].includes(env.NODE_ENV ?? "")) throw new GhlFailure("TEST_ENVIRONMENT_REQUIRED");
  const locationId = env.GHL_LOCATION_ID;
  const controlled = env.EMA_GHL_DELIVERY_MODE === "controlled-live";
  if (!locationId || (!controlled && env.EMA_GHL_APPROVED_TEST_LOCATION_ID !== locationId))
    throw new GhlFailure("APPROVED_TEST_LOCATION_REQUIRED");
  if (env.EMA_GHL_TEST_LOCATION_ID && env.EMA_GHL_TEST_LOCATION_ID !== locationId)
    throw new GhlFailure("CAPTURE_DESTINATION_MISMATCH");
  if (!controlled && env.EMA_GHL_DELIVERY_APPROVAL !== "ALLOW_SYNTHETIC_TEST_DELIVERY")
    throw new GhlFailure("DELIVERY_APPROVAL_REQUIRED");
  if (!env.EMA_GHL_PIPELINE_ID || !env.EMA_GHL_STAGE_ID) throw new GhlFailure("PIPELINE_STAGE_REQUIRED");
  let fieldIds: unknown;
  try { fieldIds = JSON.parse(env.EMA_GHL_FIELD_IDS_JSON ?? "{}"); } catch { throw new GhlFailure("FIELD_MAPPING_REQUIRED"); }
  if (!fieldIds || typeof fieldIds !== "object" || Array.isArray(fieldIds) ||
    !Object.values(fieldIds).every(v => typeof v === "string" && v.length > 0))
    throw new GhlFailure("FIELD_MAPPING_REQUIRED");
  validateFieldMapping(fieldIds as Record<string, string>);
  return { environment: env.NODE_ENV as "development" | "test", locationId,
    pipelineId: env.EMA_GHL_PIPELINE_ID, stageId: env.EMA_GHL_STAGE_ID, fieldIds: fieldIds as Record<string, string>,
    ...(controlled ? { controlled: controlledConfig(env, locationId) } : {}) };
}
function productionConfig(env: GhlEnvironment): GhlConfig {
  // Controlled-live remains an isolated three-record dev/test harness. Its
  // approvals can never authorize general production capture or delivery.
  if (env.EMA_GHL_DELIVERY_MODE !== "production" || env.EMA_GHL_CONTROLLED_MANIFEST_JSON ||
    env.EMA_GHL_CONTROLLED_LIVE_APPROVAL || env.EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID)
    throw new GhlFailure("PRODUCTION_MODE_REQUIRED");
  if (env.EMA_GHL_PRODUCTION_SCHEMA_APPROVAL !== "ALLOW_PRODUCTION_SCHEMA_V2")
    throw new GhlFailure("PRODUCTION_SCHEMA_APPROVAL_REQUIRED");
  const locationId = env.GHL_LOCATION_ID;
  if (!locationId || !/^[A-Za-z0-9_-]+$/.test(locationId) ||
    env.EMA_GHL_APPROVED_PRODUCTION_LOCATION_ID !== locationId)
    throw new GhlFailure("APPROVED_PRODUCTION_LOCATION_REQUIRED");
  if (env.EMA_GHL_TEST_LOCATION_ID || env.EMA_GHL_APPROVED_TEST_LOCATION_ID)
    throw new GhlFailure("PRODUCTION_TEST_DESTINATION_CONFLICT");
  if (!env.EMA_GHL_PIPELINE_ID?.trim() || !env.EMA_GHL_STAGE_ID?.trim())
    throw new GhlFailure("PIPELINE_STAGE_REQUIRED");
  let fields: unknown;
  try { fields = JSON.parse(env.EMA_GHL_FIELD_IDS_JSON ?? "null"); } catch { throw new GhlFailure("FIELD_MAPPING_REQUIRED"); }
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new GhlFailure("FIELD_MAPPING_REQUIRED");
  const fieldIds = fields as Record<string, string>;
  validateFieldMapping(fieldIds);
  const keys = fieldDefinitions.map(f => `${f.model}.${f.key}`);
  if (Object.keys(fieldIds).length !== keys.length || keys.some(key => !Object.hasOwn(fieldIds, key)))
    throw new GhlFailure("FIELD_MAPPING_REQUIRED");
  return { environment: "production", locationId, pipelineId: env.EMA_GHL_PIPELINE_ID,
    stageId: env.EMA_GHL_STAGE_ID, fieldIds };
}
export function liveGhlClient(): never {
  // Intentionally unconditional. No credential reads, fetch, SDK, or override switch.
  throw new GhlFailure("LIVE_GHL_WRITES_DISABLED");
}