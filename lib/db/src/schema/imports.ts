import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// CRM Phase B — bulk import pipeline ----------------------------------------
//
// Two tables back the CSV/XLSX import wizard. Both are admin-only; no public
// route ever touches them. The parent `import_jobs` row is the canonical
// state machine for one upload; the child `import_job_rows` stores both the
// raw source row (forever — it's the audit trail) AND the parsed/normalised
// version once the operator submits a column mapping.
//
// State machine for `import_jobs.status`:
//   uploaded   — file parsed, raw rows persisted, awaiting column mapping
//   mapped     — operator submitted mapping; rows validated and now have
//                a status of `valid` or `invalid`. Job is "previewing".
//   completed  — operator hit Commit; per-row results are settled
//                (imported / updated / skipped_duplicate / invalid).
//   failed     — fatal parse/commit error; `error_summary` carries reason.
//
// State machine for `import_job_rows.status`:
//   pending           — raw row stored, mapping not yet applied
//   valid             — mapping + zod validation passed
//   invalid           — mapping + zod validation failed; see `errors`
//   imported          — committed as a NEW prelaunch_leads row
//   updated           — committed as an UPDATE to an existing lead (dedupe)
//   skipped_duplicate — matched an existing lead and strategy=skip
//
// The `dedupe_strategy` column on the parent job is set when the operator
// submits the mapping step and reused at commit time:
//   skip          — never overwrite, drop duplicates
//   update        — overwrite the matched lead's mapped fields
//   create_anyway — bypass dedupe entirely; always insert new rows
export const importJobsTable = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // admin_users.id of the operator who uploaded. No FK constraint enforced
  // at the DB layer (matches the rest of the schema's soft-FK convention);
  // checked at the API layer when populating req.adminUser.
  uploadedBy: uuid("uploaded_by"),
  sourceFilename: text("source_filename").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  mime: text("mime").notNull(),
  // individual | professional — chosen by the operator at step 1 of the
  // wizard. Drives which field-mapping schema is used downstream.
  leadType: text("lead_type").notNull(),
  status: text("status").notNull().default("uploaded"),
  // jsonb mapping of { sourceColumnName: leadFieldName | null }. null
  // means the column is intentionally unmapped (and may surface as a
  // `csv:colname=value` tag if the lenient_capture policy is in force).
  columnMapping: jsonb("column_mapping"),
  dedupeStrategy: text("dedupe_strategy"),
  errorSummary: jsonb("error_summary"),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsValid: integer("rows_valid").notNull().default(0),
  rowsInvalid: integer("rows_invalid").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsUpdated: integer("rows_updated").notNull().default(0),
  rowsSkippedDuplicate: integer("rows_skipped_duplicate")
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const importJobRowsTable = pgTable("import_job_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  // import_jobs.id — soft FK, checked at the API layer.
  jobId: uuid("job_id").notNull(),
  // 0-based index into the source file; preserves original ordering when
  // the operator reviews the preview/error grid.
  rowIndex: integer("row_index").notNull(),
  // The verbatim source row as a JSON object (column → string). Stored
  // forever so the import is replay-able and so the errors.csv export
  // can always re-render the original cells.
  raw: jsonb("raw").notNull(),
  // Post-mapping, post-validation normalised shape. NULL until mapping
  // is submitted. For valid rows, this is the object that gets passed
  // to the prelaunch_leads insert/update.
  parsed: jsonb("parsed"),
  status: text("status").notNull().default("pending"),
  // Array of { field, message } objects when status='invalid'. NULL
  // otherwise.
  errors: jsonb("errors"),
  // Set on commit: prelaunch_leads.id this row mapped to (whether
  // freshly inserted or matched-and-updated). NULL for invalid /
  // skipped rows.
  resolvedLeadId: uuid("resolved_lead_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ImportJob = typeof importJobsTable.$inferSelect;
export type InsertImportJob = typeof importJobsTable.$inferInsert;
export type ImportJobRow = typeof importJobRowsTable.$inferSelect;
export type InsertImportJobRow = typeof importJobRowsTable.$inferInsert;
