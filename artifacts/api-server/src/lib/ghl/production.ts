import { sql } from "drizzle-orm";
import { GhlFailure, type GhlConfig } from "./config";
import type { Executor } from "./snapshots";
import type { GhlClient } from "./client";
import { fieldDefinitions, providerFieldKeyMatches } from "./fields";
import { remoteFieldOptionsMatch } from "./field-options";
const ready = new WeakMap<GhlConfig, { db: Executor; client: GhlClient; fingerprint: string }>();

export async function prepareProductionDelivery(db: Executor, client: GhlClient, config: GhlConfig) {
  await validateProductionSchema(db);
  await validateProductionDestination(client, config);
  ready.set(config, { db, client, fingerprint: JSON.stringify(config) });
}
export function assertProductionDeliveryReady(db: Executor, client: GhlClient, config: GhlConfig) {
  const receipt = ready.get(config);
  if (!receipt || receipt.db !== db || receipt.client !== client || receipt.fingerprint !== JSON.stringify(config))
    throw new GhlFailure("PRODUCTION_PREFLIGHT_REQUIRED");
}

/** Read-only, uncached: never migrates, inserts a probe, or trusts an env receipt. */
export async function validateProductionSchema(db: Executor) {
  try {
    await db.execute(sql`SELECT id,lead_id,flow,answers,attribution,captured_at,completed_at FROM ema_assessment_submissions LIMIT 0`);
    await db.execute(sql`SELECT id,submission_id,environment,location_id,kind,ordinal,state,attempts,available_at,
      lease_token,lease_until,remote_id,result,error_code,confirmed_at FROM ema_ghl_operations LIMIT 0`);
    await db.execute(sql`SELECT id,operation_id,action,started_at,finished_at,outcome,http_status,error_code FROM ema_ghl_attempts LIMIT 0`);
    await db.execute(sql`SELECT environment,location_id,lead_id,contact_id,opportunity_id,latest_completed_at FROM ema_ghl_links LIMIT 0`);
    await db.execute(sql`SELECT scope,token,expires_at FROM ema_ghl_worker_leases LIMIT 0`);
    await db.execute(sql`SELECT scope,operation_id,action,created_at FROM ema_ghl_mutation_barriers LIMIT 0`);
    const result = await db.execute(sql`SELECT conrelid::regclass::text AS name,
      pg_get_expr(conbin,conrelid) AS expression, convalidated AS validated
      FROM pg_constraint WHERE (conrelid='ema_ghl_operations'::regclass AND conname='ema_ghl_operations_environment_check')
      OR (conrelid='ema_ghl_links'::regclass AND conname='ema_ghl_links_environment_check')`) as { rows: any[] };
    const expected = "(environment = ANY (ARRAY['development'::text, 'test'::text, 'production'::text]))";
    if (result.rows.length !== 2 || result.rows.some(r => !r.validated || r.expression !== expected))
      throw new Error("schema");
    const safety = await db.execute(sql`SELECT
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='ema_assessment_submissions'::regclass
        AND tgname='ema_snapshot_immutable' AND tgenabled IN ('O','A') AND NOT tgisinternal) AS immutable,
      EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('ema_ghl_opportunity_owner')
        AND indisunique AND indisvalid) AS ownership`) as { rows: any[] };
    if (!safety.rows[0]?.immutable || !safety.rows[0]?.ownership) throw new Error("schema");
  } catch { throw new GhlFailure("PRODUCTION_SCHEMA_NOT_READY"); }
}

/** No setup mutations: validates model/type/options and selected destination. */
export async function validateProductionDestination(client: GhlClient, config: GhlConfig) {
  for (const model of ["contact", "opportunity"]) {
    const response = await client.request("GET", `/locations/${encodeURIComponent(config.locationId)}/customFields?model=${model}`);
    const fields = response.body?.customFields;
    if (!Array.isArray(fields)) throw new GhlFailure("PRODUCTION_FIELD_MAPPING_MISMATCH");
    for (const definition of fieldDefinitions.filter(f => f.model === model)) {
      const matches = fields.filter(f => f.id === config.fieldIds[`${model}.${definition.key}`]);
      const f = matches[0];
      if (matches.length !== 1 || f.model !== model || !providerFieldKeyMatches(f.fieldKey, definition) ||
        f.dataType !== definition.dataType || !remoteFieldOptionsMatch(f, definition.options))
        throw new GhlFailure("PRODUCTION_FIELD_MAPPING_MISMATCH");
    }
  }
  const response = await client.request("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(config.locationId)}`);
  const pipelines = response.body?.pipelines;
  if (!Array.isArray(pipelines) || pipelines.filter(p => p.id === config.pipelineId &&
    Array.isArray(p.stages) && p.stages.some((s: any) => s.id === config.stageId)).length !== 1)
    throw new GhlFailure("PRODUCTION_PIPELINE_STAGE_MISMATCH");
}