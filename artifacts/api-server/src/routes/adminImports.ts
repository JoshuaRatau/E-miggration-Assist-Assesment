import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  importJobsTable,
  importJobRowsTable,
} from "@workspace/db";
import { requireAdminAuth } from "../lib/adminAuth";
import { parseFile, MAX_ROWS } from "../lib/imports/parseFile";
import {
  suggestMapping,
  validateRow,
  fieldsForLeadType,
  LEAD_TYPE_SCHEMA,
  DEDUPE_SCHEMA,
  type LeadField,
} from "../lib/imports/mapping";
import { commitImportJob } from "../lib/imports/commit";
import { writeAudit } from "../lib/audit";
import type { LeadType } from "../lib/classification";

// 10 MiB hard cap. The parser-level row cap (5 000) is enforced in
// parseFile.ts; this byte cap is the cheap first line of defence so an
// oversized upload is rejected before we even read the buffer into RAM.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

const router: IRouter = Router();

const UploadBody = z.object({ leadType: LEAD_TYPE_SCHEMA });
const MappingBody = z.object({
  mapping: z.record(z.string(), z.string().nullable()),
  dedupeStrategy: DEDUPE_SCHEMA,
});

function serializeJob(j: typeof importJobsTable.$inferSelect) {
  return {
    id: j.id,
    uploadedBy: j.uploadedBy,
    sourceFilename: j.sourceFilename,
    fileSizeBytes: j.fileSizeBytes,
    mime: j.mime,
    leadType: j.leadType,
    status: j.status,
    columnMapping: j.columnMapping,
    dedupeStrategy: j.dedupeStrategy,
    errorSummary: j.errorSummary,
    rowsTotal: j.rowsTotal,
    rowsValid: j.rowsValid,
    rowsInvalid: j.rowsInvalid,
    rowsImported: j.rowsImported,
    rowsUpdated: j.rowsUpdated,
    rowsSkippedDuplicate: j.rowsSkippedDuplicate,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}

/**
 * POST /api/admin/imports
 *
 * Multipart upload of a CSV or XLSX file. Persists the parsed raw rows and
 * returns the job id, detected columns, an auto-suggested column→field
 * mapping, and the field allow-list for the chosen leadType. No leads are
 * created at this stage — the operator must POST the mapping next.
 */
router.post("/admin/imports", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  upload.single("file")(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr instanceof multer.MulterError) {
        return res.status(400).json({
          error: uploadErr.code,
          message: uploadErr.message,
        });
      }
      return res.status(400).json({
        error: "UPLOAD_FAILED",
        message: (uploadErr as Error).message,
      });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const body = UploadBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({
        error: "Invalid input",
        details: body.error.issues,
      });
    }

    const parsed = parseFile({
      buffer: file.buffer,
      mime: file.mimetype,
      filename: file.originalname,
    });
    if ("code" in parsed) {
      return res.status(400).json({
        error: parsed.code,
        message: parsed.message,
      });
    }

    const [job] = await db
      .insert(importJobsTable)
      .values({
        uploadedBy: req.adminUser?.id ?? null,
        sourceFilename: file.originalname,
        fileSizeBytes: file.size,
        mime: file.mimetype,
        leadType: body.data.leadType,
        status: "uploaded",
        rowsTotal: parsed.rows.length,
      })
      .returning();
    if (!job) return res.status(500).json({ error: "INSERT_FAILED" });

    // Bulk-insert raw rows in chunks so we stay under Postgres' parameter
    // limit (each row contributes ~4 placeholders → 5000 rows / 500 chunk
    // = 10 round-trips worst-case).
    const CHUNK = 500;
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      const slice = parsed.rows.slice(i, i + CHUNK).map((raw, idx) => ({
        jobId: job.id,
        rowIndex: i + idx,
        raw: raw as never,
        status: "pending",
      }));
      await db.insert(importJobRowsTable).values(slice);
    }

    const suggested = suggestMapping(parsed.columns, body.data.leadType);
    await writeAudit({
      req,
      action: "import_uploaded",
      after: {
        jobId: job.id,
        rows: parsed.rows.length,
        leadType: body.data.leadType,
        filename: file.originalname,
      },
    });
    return res.status(201).json({
      job: serializeJob(job),
      columns: parsed.columns,
      suggestedMapping: suggested,
      availableFields: fieldsForLeadType(body.data.leadType),
      maxRows: MAX_ROWS,
    });
  });
});

/**
 * POST /api/admin/imports/:id/mapping
 *
 * Apply a column→field mapping + dedupe strategy. Re-validates every row
 * (idempotent — safe to re-run if the operator tweaks the mapping in the
 * preview step). Sets the job to status='mapped' and updates the totals so
 * the preview screen can render `rowsValid` / `rowsInvalid`.
 */
router.post("/admin/imports/:id/mapping", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  const body = MappingBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: "Invalid input",
      details: body.error.issues,
    });
  }
  const [job] = await db
    .select()
    .from(importJobsTable)
    .where(eq(importJobsTable.id, id))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Not found" });
  if (job.status !== "uploaded" && job.status !== "mapped") {
    // Once a commit has been claimed (status='committing') or settled
    // (completed/failed), mapping changes are forbidden — they would
    // either race against the running commit loop or rewrite the
    // outcome of an already-settled job.
    return res.status(409).json({
      error: "Job no longer accepts mapping changes",
      status: job.status,
    });
  }

  const leadType = job.leadType as LeadType;
  const allowed = new Set<LeadField>(fieldsForLeadType(leadType));
  // Defensive cleaning: drop any field name the operator submitted that
  // isn't in the allow-list for this leadType (treat as "unmapped").
  const cleanedMapping: Record<string, string | null> = {};
  for (const [col, target] of Object.entries(body.data.mapping)) {
    cleanedMapping[col] =
      target && allowed.has(target as LeadField) ? target : null;
  }

  const rows = await db
    .select()
    .from(importJobRowsTable)
    .where(eq(importJobRowsTable.jobId, job.id))
    .orderBy(asc(importJobRowsTable.rowIndex));

  let valid = 0;
  let invalid = 0;
  for (const row of rows) {
    const result = validateRow({
      raw: row.raw as Record<string, string>,
      mapping: cleanedMapping,
      leadType,
    });
    if (result.ok) {
      valid++;
      await db
        .update(importJobRowsTable)
        .set({
          parsed: result.parsed as never,
          errors: null,
          status: "valid",
        })
        .where(eq(importJobRowsTable.id, row.id));
    } else {
      invalid++;
      await db
        .update(importJobRowsTable)
        .set({
          parsed: null,
          errors: result.errors as never,
          status: "invalid",
        })
        .where(eq(importJobRowsTable.id, row.id));
    }
  }

  const [updatedJob] = await db
    .update(importJobsTable)
    .set({
      status: "mapped",
      columnMapping: cleanedMapping as never,
      dedupeStrategy: body.data.dedupeStrategy,
      rowsValid: valid,
      rowsInvalid: invalid,
      updatedAt: new Date(),
    })
    .where(eq(importJobsTable.id, job.id))
    .returning();

  return res.json({
    job: serializeJob(updatedJob!),
    rowsValid: valid,
    rowsInvalid: invalid,
  });
});

/**
 * GET /api/admin/imports/:id
 *
 * Job state + paginated rows for the preview/error grid. Pagination caps
 * at 500 rows/page; the operator-facing UI defaults to 100.
 */
router.get("/admin/imports/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  const [job] = await db
    .select()
    .from(importJobsTable)
    .where(eq(importJobsTable.id, id))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Not found" });

  const limit = Math.min(
    parseInt(String(req.query.limit ?? "100"), 10) || 100,
    500,
  );
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const statusFilter =
    typeof req.query.status === "string" ? req.query.status : null;
  const where = statusFilter
    ? and(
        eq(importJobRowsTable.jobId, id),
        eq(importJobRowsTable.status, statusFilter),
      )
    : eq(importJobRowsTable.jobId, id);

  const rows = await db
    .select()
    .from(importJobRowsTable)
    .where(where)
    .orderBy(asc(importJobRowsTable.rowIndex))
    .limit(limit)
    .offset(offset);

  return res.json({
    job: serializeJob(job),
    rows: rows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      raw: r.raw,
      parsed: r.parsed,
      status: r.status,
      errors: r.errors,
      resolvedLeadId: r.resolvedLeadId,
    })),
  });
});

/**
 * POST /api/admin/imports/:id/commit
 *
 * Execute the import. Idempotent: if the job is already `completed` we
 * return the previously-settled summary instead of re-running. Catastrophic
 * failures flip the job to `failed` with an `error_summary` so the
 * operator can see what went wrong without re-uploading.
 */
router.post("/admin/imports/:id/commit", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  const [job] = await db
    .select()
    .from(importJobsTable)
    .where(eq(importJobsTable.id, id))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Not found" });

  if (job.status === "completed") {
    return res.json({
      job: serializeJob(job),
      summary: {
        imported: job.rowsImported,
        updated: job.rowsUpdated,
        skippedDuplicate: job.rowsSkippedDuplicate,
        invalid: job.rowsInvalid,
        total: job.rowsTotal,
      },
      idempotent: true,
    });
  }
  if (job.status !== "mapped") {
    return res.status(409).json({
      error: "Job is not ready to commit",
      status: job.status,
    });
  }

  // Concurrency guard: atomic CAS to claim the job. If two operators (or
  // a double-clicked button) both call /commit while status='mapped',
  // exactly one wins the WHERE clause; the loser sees zero affected rows
  // and gets a 409. This closes the race that would otherwise let two
  // commit loops both process the `valid` rows before either flipped them
  // to `imported`, causing duplicate inserts.
  const [claimed] = await db
    .update(importJobsTable)
    .set({ status: "committing", updatedAt: new Date() })
    .where(
      and(eq(importJobsTable.id, job.id), eq(importJobsTable.status, "mapped")),
    )
    .returning();
  if (!claimed) {
    const [now] = await db
      .select()
      .from(importJobsTable)
      .where(eq(importJobsTable.id, job.id))
      .limit(1);
    return res.status(409).json({
      error: "Job commit already in progress or settled",
      status: now?.status ?? null,
    });
  }

  try {
    const summary = await commitImportJob({
      req,
      jobId: job.id,
      log: req.log,
    });
    await writeAudit({
      req,
      action: "import_committed",
      after: { jobId: job.id, ...summary },
    });
    const [final] = await db
      .select()
      .from(importJobsTable)
      .where(eq(importJobsTable.id, job.id))
      .limit(1);
    return res.json({ job: serializeJob(final!), summary });
  } catch (err) {
    req.log.warn(
      { err: (err as Error).message, jobId: job.id },
      "import commit failed",
    );
    await db
      .update(importJobsTable)
      .set({
        status: "failed",
        errorSummary: { message: (err as Error).message } as never,
        updatedAt: new Date(),
      })
      .where(eq(importJobsTable.id, job.id));
    return res.status(500).json({
      error: "COMMIT_FAILED",
      message: (err as Error).message,
    });
  }
});

/**
 * GET /api/admin/imports/:id/errors.csv
 *
 * Downloadable CSV of every row that failed validation, with one cell per
 * source column plus a synthetic `errors` column listing each per-cell
 * problem. Operators fix it externally and re-upload; nothing on the job
 * itself changes.
 */
router.get("/admin/imports/:id/errors.csv", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const { id } = req.params;
  const [job] = await db
    .select()
    .from(importJobsTable)
    .where(eq(importJobsTable.id, id))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Not found" });

  const invalidRows = await db
    .select()
    .from(importJobRowsTable)
    .where(
      and(
        eq(importJobRowsTable.jobId, id),
        eq(importJobRowsTable.status, "invalid"),
      ),
    )
    .orderBy(asc(importJobRowsTable.rowIndex));

  const allCols = new Set<string>();
  for (const r of invalidRows) {
    for (const k of Object.keys(r.raw as Record<string, unknown>)) {
      allCols.add(k);
    }
  }
  const cols = Array.from(allCols);
  const header = ["row", "errors", ...cols];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of invalidRows) {
    const errs =
      (r.errors as Array<{ field: string; message: string }> | null) ?? [];
    const errStr = errs.map((e) => `${e.field}: ${e.message}`).join("; ");
    const raw = r.raw as Record<string, string>;
    const cells = [
      String(r.rowIndex + 1),
      errStr,
      ...cols.map((c) => raw[c] ?? ""),
    ];
    lines.push(cells.map(csvEscape).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="import-${id.slice(0, 8)}-errors.csv"`,
  );
  return res.send(lines.join("\n"));
});

// Defuse CSV-injection vectors before quoting. Cells beginning with =, +,
// -, @, tab, or CR are interpreted as formulas by Excel/Sheets/Numbers when
// the file is opened; prefixing with a single apostrophe forces them back
// to literal text. Then apply the standard quote-and-escape pass.
//
// Reference: OWASP "CSV Injection" / CWE-1236.
function csvEscape(s: string): string {
  let safe = s;
  if (safe.length > 0 && /^[=+\-@\t\r]/.test(safe)) {
    safe = `'${safe}`;
  }
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * GET /api/admin/imports
 *
 * List the most recent import jobs (newest first). Used by the wizard's
 * landing screen to show "your last few imports".
 */
router.get("/admin/imports", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const limit = Math.min(
    parseInt(String(req.query.limit ?? "50"), 10) || 50,
    200,
  );
  const jobs = await db
    .select()
    .from(importJobsTable)
    .orderBy(desc(importJobsTable.createdAt))
    .limit(limit);
  return res.json({ jobs: jobs.map(serializeJob) });
});

export default router;
