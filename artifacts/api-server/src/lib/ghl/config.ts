export const operationKinds = ["contact", "contact_verify", "history", "history_verify", "opportunity", "opportunity_verify"] as const;
export type OperationKind = typeof operationKinds[number];
export type GhlConfig = {
  environment: "development" | "test";
  locationId: string;
  pipelineId?: string;
  stageId?: string;
  fieldIds: Record<string, string>;
};

// Capture is separately enabled only AFTER the additive migration is deliberately applied.
// This does NOT enable a network client, worker, setup writes, or production delivery.
export function captureEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.EMA_GHL_CAPTURE_ENABLED === "true";
}
export function captureConfig(): GhlConfig {
  const locationId = process.env.EMA_GHL_TEST_LOCATION_ID;
  if (!locationId) throw new Error("EMA_GHL_TEST_LOCATION_ID_REQUIRED");
  return { environment: "development", locationId, fieldIds: {} };
}

export class GhlFailure extends Error {
  constructor(public code: string, public status?: number, public retryAfterMs?: number) { super(code); }
}
export function liveGhlClient(): never {
  // Intentionally unconditional. No credential reads, fetch, SDK, or override switch.
  throw new GhlFailure("LIVE_GHL_WRITES_DISABLED");
}