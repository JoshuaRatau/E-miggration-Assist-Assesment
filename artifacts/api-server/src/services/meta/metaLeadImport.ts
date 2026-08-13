import { db, prelaunchLeadsTable, metaLeadsTable, type MetaLead } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";

// Meta lead → CRM lead bridge. Meta Lead Ads submissions land in
// `meta_leads` (raw, attributed) AND flow into the existing Leads Centre
// (`prelaunch_leads`) exactly once. Dedupe mirrors the intake routes:
// case-insensitive email OR exact normalized WhatsApp — a duplicate links
// to the EXISTING CRM record instead of creating a parallel one.

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+27${digits.slice(1)}`; // ZA default
  return `+${digits}`;
}

function makeReference(): string {
  return `EMA-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0")}`;
}

/**
 * Import one meta_leads row into the CRM. Sets import_status and
 * crm_lead_id on the meta_leads row. Idempotent: already-imported rows
 * are skipped.
 */
export async function importMetaLeadToCrm(metaLead: MetaLead): Promise<void> {
  if (metaLead.crmLeadId || metaLead.importStatus === "imported") return;

  const email = metaLead.email?.trim().toLowerCase() || null;
  const phone = normalizePhone(metaLead.phone);

  if (!email && !phone) {
    await db
      .update(metaLeadsTable)
      .set({ importStatus: "skipped_no_contact", updatedAt: new Date() })
      .where(eq(metaLeadsTable.id, metaLead.id));
    return;
  }

  try {
    // Transaction + advisory lock on the contact identity: concurrent
    // imports of the same person (webhook + sync race, or two Meta leads
    // sharing an email) serialize here, so the read-then-insert dedupe
    // below cannot double-create a CRM row.
    await db.transaction(async (tx) => {
      const identity = email ?? phone!;
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`meta-lead-import:${identity}`}))`,
      );

      // Dedupe against existing CRM leads (same rule as intake routes).
      const conditions: ReturnType<typeof sql>[] = [];
      if (email)
        conditions.push(sql`lower(${prelaunchLeadsTable.email}) = ${email}`);
      if (phone) conditions.push(sql`${prelaunchLeadsTable.whatsapp} = ${phone}`);
      const whereClause = conditions.length === 2
        ? sql`${conditions[0]} OR ${conditions[1]}`
        : conditions[0]!;

      const [existing] = await tx
        .select({ id: prelaunchLeadsTable.id })
        .from(prelaunchLeadsTable)
        .where(whereClause)
        .orderBy(sql`${prelaunchLeadsTable.createdAt} DESC`)
        .limit(1);

      if (existing) {
        await tx
          .update(metaLeadsTable)
          .set({
            crmLeadId: existing.id,
            importStatus: "duplicate",
            updatedAt: new Date(),
          })
          .where(eq(metaLeadsTable.id, metaLead.id));
        return;
      }

      const [created] = await tx
        .insert(prelaunchLeadsTable)
        .values({
        referenceNumber: makeReference(),
        fullName: metaLead.fullName ?? "Meta lead",
        email: email ?? `meta-${metaLead.metaLeadId}@no-email.invalid`,
        whatsapp: phone,
        consentAccepted: true, // Meta Instant Forms include consent capture
        consentTimestamp: metaLead.metaCreatedAt ?? new Date(),
        leadType: "individual",
        source: "meta",
        sourceCampaign: metaLead.metaCampaignId,
        leadStatus: "new",
        internalClassification: "meta_lead_ad",
        adminNotes: JSON.stringify({
          meta: {
            platform: metaLead.platform,
            meta_lead_id: metaLead.metaLeadId,
            page_id: metaLead.pageId,
            campaign_id: metaLead.metaCampaignId,
            adset_id: metaLead.metaAdSetId,
            ad_id: metaLead.metaAdId,
            form_id: metaLead.metaFormId,
            answers: metaLead.fieldData ?? null,
          },
        }),
        })
        .returning({ id: prelaunchLeadsTable.id });

      await tx
        .update(metaLeadsTable)
        .set({
          crmLeadId: created!.id,
          importStatus: "imported",
          updatedAt: new Date(),
        })
        .where(eq(metaLeadsTable.id, metaLead.id));
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), metaLeadId: metaLead.metaLeadId },
      "Meta lead CRM import failed",
    );
    await db
      .update(metaLeadsTable)
      .set({ importStatus: "error", updatedAt: new Date() })
      .where(eq(metaLeadsTable.id, metaLead.id));
  }
}
