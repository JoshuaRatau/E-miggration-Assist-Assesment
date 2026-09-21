import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pathToFileURL } from "node:url";
import { buildPgPoolConfig } from "../../../lib/db/src/ssl";
import { HttpGhlClient } from "../src/lib/ghl/client";
import { deliveryConfig, GhlFailure, type GhlEnvironment } from "../src/lib/ghl/config";
import { prepareProductionDelivery } from "../src/lib/ghl/production";

export type ProductionCheckDependencies = {
  env?: GhlEnvironment;
  fetch?: typeof fetch;
};

/** Read-only production preflight. It neither starts the app nor performs contact writes. */
export async function runProductionCheck(deps: ProductionCheckDependencies = {}) {
  const env = deps.env ?? process.env;
  const config = deliveryConfig(env);
  if (config.environment !== "production") throw new GhlFailure("PRODUCTION_MODE_REQUIRED");
  const databaseUrl = env.DATABASE_URL;
  const token = env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!databaseUrl) throw new GhlFailure("DATABASE_CONFIGURATION");
  if (!token || /[\r\n]/.test(token)) throw new GhlFailure("TOKEN_REQUIRED");

  const pool = new pg.Pool({
    ...buildPgPoolConfig(databaseUrl),
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    max: 1,
  });
  const db = drizzle(pool);
  const client = new HttpGhlClient({
    enabled: true,
    allowWrites: false,
    environment: "production",
    productionApproval: "ALLOW_PRODUCTION_DELIVERY",
    locationId: config.locationId,
    approvedLocationId: config.locationId,
    getToken: () => token,
    fetch: deps.fetch,
    timeoutMs: 10_000,
  });
  try {
    await prepareProductionDelivery(db, client, config);
    return {
      ok: true,
      mode: "production-read-only-preflight",
      schema: "ready",
      destination: "ready",
      writes: 0,
      piiIncluded: false,
    } as const;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionCheck().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    const code = error instanceof GhlFailure ? error.code : "PRODUCTION_PREFLIGHT_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code, piiIncluded: false })}\n`);
    process.exitCode = 1;
  });
}