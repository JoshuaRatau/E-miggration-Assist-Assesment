import { db, leadCasesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Idempotent case creation for a converted lead.
 *
 * Uses INSERT … ON CONFLICT (lead_id) DO NOTHING RETURNING so concurrent
 * PATCHes that simultaneously transition the same lead to "converted"
 * cannot produce duplicate cases — the unique constraint on `lead_id` is
 * the source of truth.  When ON CONFLICT fires, RETURNING is empty, so
 * we follow up with a SELECT to fetch the existing row.
 *
 * Returns the (possibly pre-existing) case row.  Callers must guarantee
 * that `referenceNumber` matches the lead's reference at the moment of
 * conversion — it is snapshotted into the case row as a stable label.
 */
export async function ensureCaseForLead(
  leadId: string,
  referenceNumber: string,
): Promise<typeof leadCasesTable.$inferSelect> {
  const [inserted] = await db
    .insert(leadCasesTable)
    .values({ leadId, referenceNumber })
    .onConflictDoNothing({ target: leadCasesTable.leadId })
    .returning();

  if (inserted) return inserted;

  // Conflict path — a case already exists for this lead.  Fetch and
  // return it so the caller can surface the same caseId either way.
  const [existing] = await db
    .select()
    .from(leadCasesTable)
    .where(eq(leadCasesTable.leadId, leadId))
    .limit(1);

  if (!existing) {
    // Should be unreachable: ON CONFLICT fired but the row vanished.
    // Surface as 500 to the caller.
    throw new Error(
      `ensureCaseForLead: conflict reported for lead ${leadId} but no case row found`,
    );
  }
  return existing;
}

/** Touch a case's updatedAt — kept here to centralise the column update. */
export async function touchCaseUpdatedAt(caseId: string): Promise<void> {
  await db
    .update(leadCasesTable)
    .set({ updatedAt: sql`now()` })
    .where(eq(leadCasesTable.id, caseId));
}
