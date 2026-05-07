import type { Logger } from "pino";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  prelaunchLeadsTable,
  importJobsTable,
  importJobRowsTable,
} from "@workspace/db";
import {
  classifyCase,
  deriveAutoPriority,
  generateReferenceNumber,
} from "../classification";
import { normalizeWhatsapp } from "../whatsapp";
import { buildConfirmationDispatcher } from "../confirmation";
import { writeAudit } from "../audit";
import { findDuplicateLead } from "./dedupe";
import type { DedupeStrategy } from "./mapping";
import { resolveOrgType } from "./classifyOrg";

export interface CommitSummary {
  imported: number;
  updated: number;
  skippedDuplicate: number;
  invalid: number;
  total: number;
}

/**
 * Walk every row of an import job and apply the operator's chosen dedupe
 * strategy. Per-row outcomes:
 *   - imported          → INSERT a new prelaunch_leads row (+ audit + confirmation)
 *   - updated           → UPDATE matched lead's mapped fields (+ audit, NO confirmation)
 *   - skipped_duplicate → mark the row, leave the matched lead untouched
 *   - invalid           → already terminal at mapping time; counted only
 *
 * The function is best-effort idempotent at the row level: any row already
 * in a terminal status is left alone, so a retry after a partial-failure
 * does NOT double-insert. Job-level totals are recomputed from scratch each
 * call so the parent stays consistent with the children.
 *
 * Confirmation dispatch deliberately fires only for fresh inserts (not for
 * dedupe-update rows). Operators chose to enable confirmations on import
 * (Phase B Q3) and the per-lead 24h cooldown inside `dispatchConfirmation`
 * prevents a re-import of the same CSV from spamming a contact who already
 * received the welcome message.
 */
export async function commitImportJob(args: {
  req: Request;
  jobId: string;
  log: Logger;
}): Promise<CommitSummary> {
  const { req, jobId, log } = args;
  const [job] = await db
    .select()
    .from(importJobsTable)
    .where(eq(importJobsTable.id, jobId))
    .limit(1);
  if (!job) throw new Error("import job not found");

  const strategy = (job.dedupeStrategy ?? "skip") as DedupeStrategy;
  const rows = await db
    .select()
    .from(importJobRowsTable)
    .where(eq(importJobRowsTable.jobId, jobId));

  const dispatch = buildConfirmationDispatcher({ log });

  let imported = 0;
  let updated = 0;
  let skippedDuplicate = 0;
  let invalid = 0;

  for (const row of rows) {
    if (row.status === "invalid") {
      invalid++;
      continue;
    }
    // Idempotent retry: terminal rows already have a settled outcome and
    // their counter is recomputed below from the existing status.
    if (row.status === "imported") {
      imported++;
      continue;
    }
    if (row.status === "updated") {
      updated++;
      continue;
    }
    if (row.status === "skipped_duplicate") {
      skippedDuplicate++;
      continue;
    }
    if (row.status !== "valid") continue;

    const parsed = (row.parsed ?? {}) as {
      fields?: Record<string, unknown>;
      unmappedTags?: string[];
    };
    const fields: Record<string, unknown> = { ...(parsed.fields ?? {}) };
    const unmappedTags = parsed.unmappedTags ?? [];

    // Normalise contact dimensions BEFORE dedupe so we hit the canonical
    // form on lookup AND store the canonical form on insert/update.
    // Whatsapp is ALWAYS overwritten with the normalised value (null if the
    // input was non-canonical/invalid) so we never persist a value that
    // can't participate in future dedupe — mirrors the public POST /leads
    // path's behaviour.
    const emailLc =
      typeof fields["email"] === "string"
        ? (fields["email"] as string).toLowerCase()
        : null;
    const hadWhatsappInput =
      typeof fields["whatsapp"] === "string" &&
      (fields["whatsapp"] as string).length > 0;
    const waCanonical = hadWhatsappInput
      ? normalizeWhatsapp(fields["whatsapp"] as string)
      : null;
    if (emailLc) fields["email"] = emailLc;
    if (hadWhatsappInput) fields["whatsapp"] = waCanonical; // null wipes invalid

    let match: typeof prelaunchLeadsTable.$inferSelect | null = null;
    if (strategy !== "create_anyway") {
      const outcome = await findDuplicateLead({
        email: emailLc,
        whatsapp: waCanonical,
      });
      if (outcome.kind === "conflict") {
        // Two DIFFERENT existing leads matched (one by email, one by WA).
        // Refuse to guess — surface as a row-level error so the operator
        // can resolve it manually rather than silently corrupt one lead.
        await db
          .update(importJobRowsTable)
          .set({
            status: "invalid",
            errors: [
              {
                field: "(row)",
                message: `dedupe conflict: email matches lead ${outcome.emailMatchId.slice(0, 8)} but whatsapp matches lead ${outcome.whatsappMatchId.slice(0, 8)}`,
              },
            ] as never,
          })
          .where(eq(importJobRowsTable.id, row.id));
        invalid++;
        continue;
      }
      match = outcome.kind === "match" ? outcome.lead : null;
    }

    try {
      if (match && strategy === "skip") {
        await db
          .update(importJobRowsTable)
          .set({ status: "skipped_duplicate", resolvedLeadId: match.id })
          .where(eq(importJobRowsTable.id, row.id));
        skippedDuplicate++;
        continue;
      }

      // Tag composition: explicit `tags` column ∪ lenient-capture tags ∪ a
      // job-correlation tag so the dashboard can later filter by import.
      const explicitTags = Array.isArray(fields["tags"])
        ? (fields["tags"] as string[])
        : [];
      const correlationTag = `csv-job:${job.id.slice(0, 8)}`;
      const newTags = [
        ...new Set([...explicitTags, ...unmappedTags, correlationTag]),
      ];

      if (match && strategy === "update") {
        const updates: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (k === "tags") continue;
          updates[k] = v;
        }
        // Merge tags rather than overwrite — never silently lose prior
        // categorisation an operator already applied to the lead.
        updates.tags = [...new Set([...(match.tags ?? []), ...newTags])];
        updates.updatedAt = new Date();
        await db
          .update(prelaunchLeadsTable)
          .set(updates as Partial<typeof prelaunchLeadsTable.$inferInsert>)
          .where(eq(prelaunchLeadsTable.id, match.id));
        await db
          .update(importJobRowsTable)
          .set({ status: "updated", resolvedLeadId: match.id })
          .where(eq(importJobRowsTable.id, row.id));
        await writeAudit({
          req,
          action: "lead_imported_update",
          leadId: match.id,
          before: { tags: match.tags ?? [] },
          after: {
            jobId: job.id,
            fieldsUpdated: Object.keys(updates).filter((k) => k !== "updatedAt"),
          },
        });
        updated++;
        continue;
      }

      // Fresh insert (no match, OR strategy === "create_anyway").
      const referenceNumber = generateReferenceNumber();
      const insertable: Record<string, unknown> = {
        ...fields,
        referenceNumber,
        leadType: job.leadType,
        source: `csv_import:${job.id.slice(0, 8)}`,
        // Phase B Q3: operator opted into firing confirmations on import,
        // which makes the operator the consent surrogate (they assert the
        // contact has agreed to be contacted by uploading the row). We
        // mark consent accepted at upload time so the dispatcher pipeline
        // — which short-circuits on `!consentAccepted` — actually fires.
        // The audit row records the operator id so the legal trail is intact.
        consentAccepted: true,
        consentTimestamp: new Date(),
        tags: newTags,
        ...(job.uploadedBy ? { assignedTo: job.uploadedBy } : {}),
      };

      // Auto-classification for professional leads — keyword-derive the
      // organization_type from the org name (and any free-form type hint
      // the operator mapped) so the dashboard donut chart always has a
      // valid category to bucket the row into. When the classifier had to
      // intervene we stamp `auto_classified:org_type` on the tags array
      // for transparency, so an operator can later filter/spot-check
      // anything that wasn't explicitly typed by a human.
      if (job.leadType === "professional") {
        const resolved = resolveOrgType({
          organizationName: (fields["organizationName"] as string) ?? null,
          mappedOrgType: (fields["organizationType"] as string) ?? null,
        });
        insertable.organizationType = resolved.value;
        if (resolved.autoClassified) {
          (insertable.tags as string[]) = [
            ...new Set([
              ...(insertable.tags as string[]),
              "auto_classified:org_type",
            ]),
          ];
        }
      }

      // Auto-classification for individual leads only — mirrors the public
      // POST /leads path so imported leads behave like form-submitted ones
      // in the admin dashboard (priority, score, category populated).
      if (job.leadType === "individual") {
        const cls = classifyCase({
          immigrationSituation:
            (fields["immigrationSituation"] as string) ?? null,
          overstayReason: (fields["overstayReason"] as string) ?? null,
          hasSupportingDocuments: null,
        });
        insertable.internalClassification = cls.category;
        insertable.leadCategory = cls.label;
        insertable.leadScore = cls.score;
        if (!insertable.leadPriority) {
          insertable.leadPriority = deriveAutoPriority(
            (fields["immigrationSituation"] as string) ?? null,
            (fields["visaHistory"] as string) ?? null,
          );
        }
        // Map the inquiry_type the same way the Phase A backfill did so
        // imported individuals slot cleanly into the existing reporting.
        if (fields["immigrationSituation"] === "overstay") {
          insertable["inquiryType"] = "overstay_appeal";
        } else if (!insertable["inquiryType"]) {
          insertable["inquiryType"] = "visa_inquiry";
        }
      }

      const [inserted] = await db
        .insert(prelaunchLeadsTable)
        .values(insertable as typeof prelaunchLeadsTable.$inferInsert)
        .returning();
      if (!inserted) throw new Error("insert returned no row");
      await db
        .update(importJobRowsTable)
        .set({ status: "imported", resolvedLeadId: inserted.id })
        .where(eq(importJobRowsTable.id, row.id));
      await writeAudit({
        req,
        action: "lead_imported_create",
        leadId: inserted.id,
        after: {
          jobId: job.id,
          referenceNumber: inserted.referenceNumber,
          leadType: inserted.leadType,
        },
      });
      // 24h cooldown so re-running the same CSV doesn't double-message.
      dispatch(inserted, 24 * 60);
      imported++;
    } catch (err) {
      log.warn(
        { err: (err as Error).message, rowId: row.id },
        "import-row commit failed",
      );
      await db
        .update(importJobRowsTable)
        .set({
          status: "invalid",
          errors: [
            { field: "(row)", message: (err as Error).message },
          ] as never,
        })
        .where(eq(importJobRowsTable.id, row.id))
        .catch(() => {});
      invalid++;
    }
  }

  await db
    .update(importJobsTable)
    .set({
      status: "completed",
      rowsImported: imported,
      rowsUpdated: updated,
      rowsSkippedDuplicate: skippedDuplicate,
      rowsInvalid: invalid,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(importJobsTable.id, jobId));

  return { imported, updated, skippedDuplicate, invalid, total: rows.length };
}
