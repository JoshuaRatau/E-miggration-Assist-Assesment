import { deliveryEnabled, deliveryConfig, GhlFailure, type GhlEnvironment, type GhlConfig } from "./config";
import { HttpGhlClient, type GhlClient } from "./client";
import { fieldDefinitions } from "./fields";
import { GhlWorker } from "./worker";
import type { Executor } from "./snapshots";
import { assertIsolatedControlledDatabase, preflightControlled } from "./controlled";
import { prepareProductionDelivery } from "./production";

export type DeliveryRuntime = { enabled: boolean; stop: () => Promise<void> };
export async function startGhlDelivery(options: {
  env?: GhlEnvironment;
  loadDatabase?: () => Promise<Executor>;
  controlledDatabase?: Executor;
  fetch?: typeof fetch;
  intervalMs?: number;
  makeWorker?: (db: Executor, client: GhlClient, config: GhlConfig) => { tick(): Promise<boolean> };
  onError?: (code: string) => void;
} = {}): Promise<DeliveryRuntime> {
  const env = options.env ?? process.env;
  // Must precede config, credential access, dynamic DB import and all scheduling.
  if (!deliveryEnabled(env)) return { enabled: false, stop: async () => {} };
  const config = deliveryConfig(env);
  if (config.environment === "production" && (options.controlledDatabase || options.makeWorker))
    throw new GhlFailure("PRODUCTION_RUNTIME_OVERRIDE_DENIED");
  if (config.controlled) {
    // The ordinary app startup has no isolated handle, so it cannot run this
    // mode even if somebody accidentally sets all approval variables.
    assertIsolatedControlledDatabase(options.controlledDatabase);
    if (options.loadDatabase || options.makeWorker) throw new GhlFailure("CONTROLLED_DATABASE_OVERRIDE_DENIED");
  }
  for (const field of fieldDefinitions) {
    if (!config.fieldIds[`${field.model}.${field.key}`]) throw new GhlFailure("FIELD_MAPPING_REQUIRED");
  }
  if (!env.GHL_PRIVATE_INTEGRATION_TOKEN) throw new GhlFailure("TOKEN_REQUIRED");
  const client = new HttpGhlClient({ enabled: true, allowWrites: true, environment: config.environment,
    locationId: config.locationId, approvedLocationId: config.controlled
      ? env.EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID! : config.environment === "production"
        ? env.EMA_GHL_APPROVED_PRODUCTION_LOCATION_ID! : env.EMA_GHL_APPROVED_TEST_LOCATION_ID!,
    ...(config.environment === "production" ? { productionApproval: "ALLOW_PRODUCTION_DELIVERY" as const } : {}),
    getToken: () => env.GHL_PRIVATE_INTEGRATION_TOKEN, fetch: options.fetch });
  if (config.controlled) await preflightControlled(config, client);
  const db = options.controlledDatabase ?? await (options.loadDatabase ?? (async () => (await import("@workspace/db")).db))();
  if (config.environment === "production") {
    await prepareProductionDelivery(db, client, config);
  }
  const worker = options.makeWorker ? options.makeWorker(db, client, config) : new GhlWorker(db, client, config);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  const run = () => {
    if (stopped) return;
    active = (async () => {
      try { await worker.tick(); }
      catch (error) { options.onError?.(error instanceof GhlFailure ? error.code : "DELIVERY_RUNTIME_ERROR"); }
      finally { if (!stopped) timer = setTimeout(run, options.intervalMs ?? 1000); }
    })();
  };
  run();
  return { enabled: true, stop: async () => { stopped = true; if (timer) clearTimeout(timer); await active; } };
}