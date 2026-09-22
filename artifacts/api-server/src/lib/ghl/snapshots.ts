import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { captureConfig, captureEnabled, operationKinds, type GhlConfig } from "./config";
import { validateProductionSchema } from "./production";

// Structural interface works with node-postgres and isolated PGlite Drizzle transactions.
export interface Executor { execute(query: ReturnType<typeof sql>): Promise<unknown> }
export interface Transactional extends Executor {
  transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T>;
}
export type Flow = "individual" | "overstay" | "business";
const excluded = new Set(["verifiedOtpId", "submissionAttemptId", "website", "finalize", "adminNotes"]);
export function cleanAnswers(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => !excluded.has(key) && value !== undefined));
}
export async function snapshot(
  tx: Executor, lead: { id: string; referenceNumber: string; consentTimestamp?: Date | null },
  flow: Flow, answers: Record<string, unknown>, attribution: Record<string, unknown>, submissionId?: string,
) {
  const id = submissionId ?? randomUUID();
  await tx.execute(sql`INSERT INTO ema_assessment_submissions(id,lead_id,flow,answers,attribution)
    VALUES(${id},${lead.id},${flow},${JSON.stringify({
      ...cleanAnswers(answers), referenceNumber: lead.referenceNumber,
      ...(lead.consentTimestamp ? { consentTimestamp: lead.consentTimestamp.toISOString() } : {}),
    })}::jsonb,${JSON.stringify(attribution)}::jsonb)`);
  return id;
}
export async function complete(tx: Executor, leadId: string, config: GhlConfig) {
  // An absent snapshot means pre-feature lead. Never reconstruct/backfill mutable records.
  // The single-session controlled harness needs a stable millisecond ordering
  // even when synthetic completions occur within the same clock tick.
  const completedAt = config.controlled
    ? sql`GREATEST(now(), COALESCE((SELECT max(completed_at) + interval '1 millisecond' FROM ema_assessment_submissions), now()))`
    : sql`now()`;
  await tx.execute(sql`UPDATE ema_assessment_submissions SET completed_at=${completedAt}
    WHERE lead_id=${leadId} AND completed_at IS NULL`);
  for (const [ordinal, kind] of operationKinds.entries()) {
    await tx.execute(sql`INSERT INTO ema_ghl_operations(id,submission_id,environment,location_id,kind,ordinal)
      SELECT ${randomUUID()},id,${config.environment},${config.locationId},${kind},${ordinal}
      FROM ema_assessment_submissions WHERE lead_id=${leadId} AND completed_at IS NOT NULL
      ON CONFLICT(submission_id,environment,location_id,kind) DO NOTHING`);
  }
}

// Preserve the original db path when disabled, including an unmigrated database.
export async function saveAssessment<DB extends Executor, Lead extends { id: string; referenceNumber: string; consentTimestamp?: Date | null }>(
  database: DB & { transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> },
  save: (tx: DB) => Promise<Lead[]>, flow: Flow, answers: Record<string, unknown>,
  attribution: Record<string, unknown>, isComplete: boolean,
): Promise<Lead[]> {
  if (!captureEnabled()) return save(database);
  const config = captureConfig();
  return database.transaction(async (tx) => {
    if (config.environment === "production") await validateProductionSchema(tx);
    const leads = await save(tx);
    const lead = leads[0];
    if (!lead) throw new Error("ASSESSMENT_LEAD_SAVE_FAILED");
    await snapshot(tx, lead, flow, answers, attribution);
    if (isComplete) await complete(tx, lead.id, config);
    return leads;
  });
}
export async function finalizeAssessment(database: Transactional, leadId: string) {
  if (!captureEnabled()) return;
  const config = captureConfig();
  await database.transaction(async tx => {
    if (config.environment === "production") await validateProductionSchema(tx);
    await complete(tx, leadId, config);
  });
}