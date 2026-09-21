import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { GhlFailure, type GhlConfig, type GhlEnvironment } from "./config";
import type { GhlClient, Method } from "./client";
import type { Assessment } from "./fields";
import type { Executor } from "./snapshots";
import { snapshot, complete, type Transactional } from "./snapshots";

export type ControlledRecord = {
  flow: "individual" | "overstay" | "business";
  leadId: string;
  submissionId: string;
  email: string;
  phone: string;
};
export type ControlledManifest = { locationId: string; records: ControlledRecord[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const receipts = new WeakMap<GhlConfig, { fingerprint: string; expires: number }>();
const isolated = new WeakSet<Executor>();
const digest = (manifest: ControlledManifest) => createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

export function parseControlledManifest(raw: string | undefined, locationId: string): ControlledManifest {
  let value: any;
  try { value = JSON.parse(raw ?? "null"); } catch { throw new GhlFailure("CONTROLLED_MANIFEST_REQUIRED"); }
  if (!value || value.locationId !== locationId || !Array.isArray(value.records) || value.records.length !== 3)
    throw new GhlFailure("CONTROLLED_MANIFEST_REQUIRED");
  const records: ControlledRecord[] = value.records;
  if (new Set(records.map(r => r.flow)).size !== 3 || records.some(r =>
    !["individual", "overstay", "business"].includes(r.flow) ||
    !uuid.test(r.leadId) || !uuid.test(r.submissionId) ||
    typeof r.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) ||
    r.email !== r.email.trim().toLowerCase() || !/^\+[1-9]\d{6,14}$/.test(r.phone)))
    throw new GhlFailure("CONTROLLED_MANIFEST_INVALID");
  for (const key of ["leadId", "submissionId", "email", "phone"] as const)
    if (new Set(records.map(r => r[key])).size !== 3) throw new GhlFailure("CONTROLLED_IDENTITIES_NOT_UNIQUE");
  return { locationId, records: records.map(r => ({ flow: r.flow, leadId: r.leadId, submissionId: r.submissionId, email: r.email, phone: r.phone })) };
}
export function controlledConfig(env: GhlEnvironment, locationId: string) {
  if (env.EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID !== locationId ||
    env.EMA_GHL_CONTROLLED_LIVE_APPROVAL !== "ALLOW_THREE_SYNTHETIC_RECORDS_IN_LIVE_ACCOUNT")
    throw new GhlFailure("CONTROLLED_LIVE_APPROVAL_REQUIRED");
  return parseControlledManifest(env.EMA_GHL_CONTROLLED_MANIFEST_JSON, locationId);
}
export function assertControlledRecord(manifest: ControlledManifest, s: Assessment) {
  const r = manifest.records.find(r => r.submissionId === s.id && r.leadId === s.lead_id && r.flow === s.flow);
  const a = s.answers;
  if (!r || a.email !== r.email || (a.phone && a.phone !== r.phone) || (a.whatsapp && a.whatsapp !== r.phone) ||
    (!a.phone && !a.whatsapp) || a.consentAccepted !== true)
    throw new GhlFailure("CONTROLLED_RECORD_NOT_ALLOWLISTED");
  return r;
}
export function requireControlledPreflight(config: GhlConfig) {
  if (!config.controlled) return;
  const receipt = receipts.get(config);
  if (!receipt || receipt.fingerprint !== digest(config.controlled) || receipt.expires <= Date.now())
    throw new GhlFailure("CONTROLLED_PREFLIGHT_REQUIRED");
}
/** All six identity searches must succeed with no contact before any writes.
 * In-memory receipt deliberately expires after 30 minutes and cannot be supplied
 * through environment JSON. Restart/reapproval requires operator review if prior
 * synthetic records now exist; do not treat a collision as permission to adopt.
 */
export async function preflightControlled(config: GhlConfig, readClient: GhlClient) {
  const manifest = config.controlled;
  if (!manifest) throw new GhlFailure("CONTROLLED_MANIFEST_REQUIRED");
  receipts.delete(config);
  const fingerprint = digest(manifest);
  for (const record of manifest.records) {
    for (const [key, value] of [["email", record.email], ["number", record.phone]]) {
      const response = await readClient.request("GET", `/contacts/search/duplicate?locationId=${encodeURIComponent(config.locationId)}&${key}=${encodeURIComponent(value)}`);
      if (!response.body || !Object.hasOwn(response.body, "contact")) throw new GhlFailure("CONTROLLED_PREFLIGHT_UNCERTAIN");
      if (response.body.contact !== null) throw new GhlFailure("CONTROLLED_IDENTITY_ALREADY_EXISTS");
    }
  }
  if (fingerprint !== digest(manifest)) throw new GhlFailure("CONTROLLED_MANIFEST_CHANGED");
  receipts.set(config, { fingerprint, expires: Date.now() + 30 * 60_000 });
}
export async function checkControlledDatabase(config: GhlConfig, db: Executor) {
  if (!config.controlled) return;
  requireControlledPreflight(config);
  if (!isolated.has(db)) throw new GhlFailure("CONTROLLED_ISOLATED_DATABASE_REQUIRED");
  // Read-only allowlist verification happens BEFORE lease or operation mutation.
  const result: any = await db.execute(sql`SELECT * FROM ema_assessment_submissions
    WHERE id IN (${sql.join(config.controlled.records.map(r => sql`${r.submissionId}::uuid`), sql`,`)})`);
  const rows = result.rows ?? result;
  if (rows.length !== 3) throw new GhlFailure("CONTROLLED_THREE_COMPLETED_SUBMISSIONS_REQUIRED");
  for (const row of rows) {
    assertControlledRecord(config.controlled, row);
    if (!row.completed_at) throw new GhlFailure("CONTROLLED_THREE_COMPLETED_SUBMISSIONS_REQUIRED");
  }
}
export function assertIsolatedControlledDatabase(db: Executor | undefined): asserts db is Executor {
  if (!db || !isolated.has(db)) throw new GhlFailure("CONTROLLED_ISOLATED_DATABASE_REQUIRED");
}
/** Fresh embedded PostgreSQL, NO URL/pool/server/network. The app/AWS connection
 * cannot be selected. This fixture schema is NOT a migration of the application.
 * Existing full HTTP intake handlers are intentionally not started: they send
 * notifications. The controlled harness exercises transactional persistence only.
 */
export async function createControlledDatabase() {
  const [{ PGlite }, { drizzle }, { readFile }] = await Promise.all([
    import("@electric-sql/pglite"), import("drizzle-orm/pglite"), import("node:fs/promises"),
  ]);
  const pg = new PGlite();
  if (pg.dataDir !== undefined) { await pg.close(); throw new GhlFailure("CONTROLLED_DATABASE_NOT_IN_MEMORY"); }
  await pg.exec("CREATE TABLE prelaunch_leads(id uuid PRIMARY KEY, reference_number text NOT NULL UNIQUE, consent_timestamp timestamptz)");
  await pg.exec(await readFile(new URL("../../../../../lib/db/drizzle/0001_ema_ghl_outbox.sql", import.meta.url), "utf8"));
  const db = drizzle(pg);
  isolated.add(db);
  return { db, pg, isolation: "fresh-in-memory-no-network" as const, close: async () => { isolated.delete(db); await pg.close(); } };
}
export async function saveControlledFixture(db: Transactional, config: GhlConfig, submissionId: string,
  answers: Record<string, unknown>, attribution: Record<string, unknown>) {
  assertIsolatedControlledDatabase(db);
  const r = config.controlled?.records.find(r => r.submissionId === submissionId);
  if (!r || !config.controlled) throw new GhlFailure("CONTROLLED_RECORD_NOT_ALLOWLISTED");
  assertControlledRecord(config.controlled, { id: submissionId, lead_id: r.leadId, flow: r.flow, answers, attribution, completed_at: new Date() });
  await db.transaction(async tx => {
    const referenceNumber = `EMA-CONTROLLED-TEST-${r.flow}`;
    await tx.execute(sql`INSERT INTO prelaunch_leads(id,reference_number,consent_timestamp)
      VALUES(${r.leadId},${referenceNumber},now())`);
    await snapshot(tx, { id: r.leadId, referenceNumber, consentTimestamp: new Date() }, r.flow, answers, attribution, r.submissionId);
    if (r.flow !== "individual") await complete(tx, r.leadId, config);
  });
}
export async function finalizeControlledFixture(db: Transactional, config: GhlConfig, submissionId: string) {
  assertIsolatedControlledDatabase(db);
  const r = config.controlled?.records.find(r => r.submissionId === submissionId && r.flow === "individual");
  if (!r) throw new GhlFailure("CONTROLLED_RECORD_NOT_ALLOWLISTED");
  await db.transaction(tx => complete(tx, r.leadId, config));
}
export function assertControlledMutation(config: GhlConfig, s: Assessment, method: Method, path: string,
  body: Record<string, any> | undefined, contactId?: string) {
  if (!config.controlled || method === "GET") return;
  requireControlledPreflight(config);
  const r = assertControlledRecord(config.controlled, s);
  const b = body ?? {};
  const field = (key: string, model = "contact") =>
    b.customFields?.find((f: any) => f.id === config.fieldIds[`${model}.${key}`])?.fieldValue;
  if (path === "/contacts/" || (contactId && path === `/contacts/${encodeURIComponent(contactId)}`)) {
    if (b.email !== r.email || b.phone !== r.phone || field("ema_lead_id") !== r.leadId ||
      field("ema_latest_submission_id") !== r.submissionId) throw new GhlFailure("CONTROLLED_MUTATION_DENIED");
    return;
  }
  if (contactId && path === `/contacts/${encodeURIComponent(contactId)}/notes` &&
    method === "POST" && typeof b.body === "string" && b.body.includes(`[ema-submission:${r.submissionId}]`)) return;
  if (path === "/opportunities/" && method === "POST" && contactId && b.contactId === contactId &&
    b.pipelineId === config.pipelineId && b.pipelineStageId === config.stageId && b.status === "open" &&
    field("ema_lead_id", "opportunity") === r.leadId) return;
  throw new GhlFailure("CONTROLLED_MUTATION_DENIED");
}