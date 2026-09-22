import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { prelaunchLeadsTable } from "@workspace/db/schema";
import type { Response } from "express";
import { cleanAnswers, saveAssessment, type Executor, type Flow } from "./ghl/snapshots";

type Lead = { id: string; referenceNumber: string; consentTimestamp?: Date | null };
type Identity = { email?: string | null; whatsapp?: string | null; attemptId?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
class IntakeOutcome extends Error {
  constructor(readonly kind: "duplicate" | "replay" | "invalid-attempt" | "attempt-conflict", readonly lead?: any) {
    super(`INTAKE_${kind.toUpperCase()}`);
  }
}

/** Keys are independently normalized, sorted, and held through the outer COMMIT.
 * No provider call or response acknowledgment is made in this transaction.
 * Both capture-enabled and capture-disabled intake use the same protection.
 */
export async function saveIntakeAssessment<DB extends Executor, L extends Lead>(
  database: DB & { transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> },
  save: (tx: DB) => Promise<L[]>, flow: Flow, answers: Record<string, unknown>,
  attribution: Record<string, unknown>, isComplete: boolean, identity: Identity,
): Promise<L[]> {
  const attempt = identity.attemptId;
  if (attempt !== undefined && (typeof attempt !== "string" || !uuid.test(attempt)))
    throw new IntakeOutcome("invalid-attempt");
  const email = identity.email?.trim().toLowerCase() || null;
  const whatsapp = identity.whatsapp || null; // canonical E.164 supplied by the existing route normalizer
  const hash = createHash("sha256").update(canonical({ flow, answers: cleanAnswers(answers), attribution, isComplete })).digest("hex");
  return database.transaction(async tx => {
    const keys = [email && `email:${email}`, whatsapp && `phone:${whatsapp}`, attempt && `attempt:${attempt.toLowerCase()}`]
      .filter((key): key is string => typeof key === "string").sort();
    for (const key of keys) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    if (attempt) {
      const result: any = await tx.execute(sql`SELECT flow,request_hash,lead_id FROM ema_intake_receipts WHERE attempt_id=${attempt}`);
      const prior = (result.rows ?? result)[0];
      if (prior) {
        if (prior.flow !== flow || prior.request_hash !== hash) throw new IntakeOutcome("attempt-conflict");
        const [lead] = await tx.select().from(prelaunchLeadsTable).where(eq(prelaunchLeadsTable.id, prior.lead_id));
        if (!lead) throw new Error("INTAKE_RECEIPT_LEAD_MISSING");
        throw new IntakeOutcome("replay", lead);
      }
    }
    const result: any = await tx.execute(sql`SELECT id,reference_number FROM prelaunch_leads
      WHERE (${email}::text IS NOT NULL AND lower(trim(email))=${email})
        OR (${whatsapp}::text IS NOT NULL AND whatsapp=${whatsapp})
      ORDER BY created_at DESC LIMIT 1`);
    const prior = (result.rows ?? result)[0];
    if (prior) throw new IntakeOutcome("duplicate", { id: prior.id, referenceNumber: prior.reference_number });
    const leads = await saveAssessment(tx, save, flow, answers, attribution, isComplete);
    if (!leads[0]) throw new Error("ASSESSMENT_LEAD_SAVE_FAILED");
    if (attempt) await tx.execute(sql`INSERT INTO ema_intake_receipts(attempt_id,flow,request_hash,lead_id)
      VALUES(${attempt},${flow},${hash},${leads[0].id})`);
    return leads;
  });
}

/** Replayed success bypasses notifications, events, snapshot and outbox writes. */
export function sendIntakeOutcome(error: unknown, res: Response, serialize?: (lead: any) => unknown): boolean {
  if (!(error instanceof IntakeOutcome)) return false;
  if (error.kind === "replay") {
    res.status(201).json(serialize ? serialize(error.lead) :
      { leadId: error.lead.id, referenceNumber: error.lead.referenceNumber });
  } else if (error.kind === "duplicate") {
    res.status(409).json({ error: "already_registered",
      message: "This email or contact number is already registered with us. We already have your details on file.",
      referenceNumber: error.lead.referenceNumber });
  } else {
    res.status(error.kind === "invalid-attempt" ? 400 : 409).json({ error: error.kind === "invalid-attempt"
      ? "Invalid submission attempt" : "Submission attempt does not match the original request" });
  }
  return true;
}