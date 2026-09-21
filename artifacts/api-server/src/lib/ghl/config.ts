import { controlledConfig, type ControlledManifest } from "./controlled";
export const operationKinds = ["contact", "contact_verify", "history", "history_verify", "opportunity", "opportunity_verify"] as const;
export type OperationKind = typeof operationKinds[number];
export type GhlConfig = {
  environment: "development" | "test";
  locationId: string;
  pipelineId?: string;
  stageId?: string;
  fieldIds: Record<string, string>;
  controlled?: ControlledManifest;
};

// Capture is separately enabled only AFTER the additive migration is deliberately applied.
// This does NOT enable a network client, worker, setup writes, or production delivery.
export function captureEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.EMA_GHL_CAPTURE_ENABLED === "true";
}
export function captureConfig(): GhlConfig {
  const locationId = process.env.EMA_GHL_TEST_LOCATION_ID;
  if (!locationId) throw new Error("EMA_GHL_TEST_LOCATION_ID_REQUIRED");
  return { environment: process.env.NODE_ENV === "test" ? "test" : "development", locationId, fieldIds: {} };
}

export class GhlFailure extends Error {
  constructor(public code: string, public status?: number, public retryAfterMs?: number) { super(code); }
}
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
export function liveGhlClient(): never {
  // Intentionally unconditional. No credential reads, fetch, SDK, or override switch.
  throw new GhlFailure("LIVE_GHL_WRITES_DISABLED");
}