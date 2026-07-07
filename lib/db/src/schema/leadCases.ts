import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

// Lead-to-Case lightweight conversion record.
//
// One row per lead that has reached the `converted` status in the funnel.
// `leadId` is UNIQUE so the conversion can be made idempotent at the DB
// level — we use INSERT … ON CONFLICT (lead_id) DO NOTHING in
// `ensureCaseForLead()` so concurrent PATCHes that both observe a
// converted lead can never produce duplicate cases.
//
// `referenceNumber` is a snapshot of the lead's reference at conversion
// time so the case carries its own stable label even if the lead row is
// later mutated.
//
//   status ∈ initiated   (V1 default — case lifecycle stages will be
//                          added in a later phase; the column is plain
//                          text so adding values does not require a
//                          migration.)
//
// Milestone 4 Phase 12C — workflow attachment. After a case is created the
// conversion resolves the mapper's `workflowCandidate` against the canonical
// workflow registry (see `resolveWorkflow` in leadToApplication.ts):
//   - a recognised candidate ⇒ `workflow_key` is set and
//     `workflow_status = 'assigned'`;
//   - no recognised workflow ⇒ `workflow_key` stays null and
//     `workflow_status = 'review_required'` (flagged for manual review — we
//     never guess a workflow).
// `workflow_status` is plain text (default 'unassigned') so new lifecycle
// values need no migration; the 'unassigned' default also covers legacy rows
// created before this phase. Assignment is idempotent: it only transitions a
// row OUT of 'unassigned' (see `assignWorkflowForCase` in lib/cases.ts), so
// re-running conversion never overwrites an existing attachment.
//
// Milestone 4 Phase 13A — client portal ACTIVATION lifecycle (preparation
// only). `portal_status` is the persisted activation state a FUTURE phase's
// real actions will mutate:
//   not_prepared          (default — no portal prep has happened yet)
//   ready_to_activate     (a future "Prepare portal" action passed its checks)
//   activated             (a future action granted client access — terminal)
//   manual_review_required(prep found a blocker; a human must intervene)
// This phase never writes it — it defaults to 'not_prepared' for every case and
// the Lead Detail UI DERIVES a read-only readiness assessment from the case's
// workflow state (see deriveClientPortalStatus in lib/clientPortal.ts). Plain
// text so new states need no migration; the default covers legacy rows.
export const leadCasesTable = pgTable("lead_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().unique(),
  referenceNumber: text("reference_number").notNull(),
  status: text("status").notNull().default("initiated"),
  workflowKey: text("workflow_key"),
  workflowStatus: text("workflow_status").notNull().default("unassigned"),
  portalStatus: text("portal_status").notNull().default("not_prepared"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LeadCase = typeof leadCasesTable.$inferSelect;
export type InsertLeadCase = typeof leadCasesTable.$inferInsert;
