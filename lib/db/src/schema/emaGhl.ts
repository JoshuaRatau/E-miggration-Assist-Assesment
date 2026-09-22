import { pgTable, uuid, text, jsonb, timestamp, integer, unique, primaryKey, index, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { prelaunchLeadsTable } from "./leads";

export const emaAssessmentSubmissionsTable = pgTable("ema_assessment_submissions", {
  id: uuid("id").primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => prelaunchLeadsTable.id),
  flow: text("flow").notNull(),
  answers: jsonb("answers").notNull(),
  attribution: jsonb("attribution").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => [
  unique().on(t.leadId),
  check("ema_assessment_submissions_flow_check", sql`${t.flow} IN ('individual','overstay','business')`),
]);
export const insertEmaAssessmentSchema = createInsertSchema(emaAssessmentSubmissionsTable);
export type EmaAssessmentSubmission = typeof emaAssessmentSubmissionsTable.$inferSelect;

export const emaGhlOperationsTable = pgTable("ema_ghl_operations", {
  id: uuid("id").primaryKey(),
  submissionId: uuid("submission_id").notNull().references(() => emaAssessmentSubmissionsTable.id),
  environment: text("environment").notNull(),
  locationId: text("location_id").notNull(),
  kind: text("kind").notNull(),
  ordinal: integer("ordinal").notNull(),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  remoteId: text("remote_id"),
  result: jsonb("result"),
  errorCode: text("error_code"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, t => [
  unique().on(t.submissionId, t.environment, t.locationId, t.kind),
  index("ema_ghl_ready").on(t.state, t.availableAt),
  check("ema_ghl_operations_environment_check", sql`${t.environment} IN ('development','test')`),
  check("ema_ghl_operations_kind_check", sql`${t.kind} IN ('contact','contact_verify','history','history_verify','opportunity','opportunity_verify','opportunity_reuse')`),
  check("ema_ghl_operations_state_check", sql`${t.state} IN ('pending','running','retry','confirmed','review','blocked','cancelled')`),
]);
export const insertEmaGhlOperationSchema = createInsertSchema(emaGhlOperationsTable);
export type EmaGhlOperation = typeof emaGhlOperationsTable.$inferSelect;
export const emaGhlAttemptsTable = pgTable("ema_ghl_attempts", {
  id: uuid("id").primaryKey(),
  operationId: uuid("operation_id").notNull().references(() => emaGhlOperationsTable.id),
  action: text("action").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  outcome: text("outcome").notNull().default("started"),
  httpStatus: integer("http_status"),
  errorCode: text("error_code"),
  providerResponse: jsonb("provider_response"),
  correlationId: text("correlation_id"),
  correlationSource: text("correlation_source"),
  providerFailureReason: text("provider_failure_reason"),
  classificationSource: text("classification_source"),
});
export const insertEmaGhlAttemptSchema = createInsertSchema(emaGhlAttemptsTable);
export type EmaGhlAttempt = typeof emaGhlAttemptsTable.$inferSelect;
export const emaGhlCasesTable = pgTable("ema_ghl_cases", {
  environment: text("environment").notNull(),
  locationId: text("location_id").notNull(),
  contactId: text("contact_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
}, t => [
  primaryKey({ columns: [t.environment, t.locationId, t.contactId] }),
  unique().on(t.environment, t.locationId, t.opportunityId),
  unique().on(t.environment, t.locationId, t.contactId, t.opportunityId),
]);
export const insertEmaGhlCaseSchema = createInsertSchema(emaGhlCasesTable);
export type EmaGhlCase = typeof emaGhlCasesTable.$inferSelect;
export const emaGhlLinksTable = pgTable("ema_ghl_links", {
  environment: text("environment").notNull(),
  locationId: text("location_id").notNull(),
  leadId: uuid("lead_id").notNull().references(() => prelaunchLeadsTable.id),
  contactId: text("contact_id"),
  opportunityId: text("opportunity_id"),
  latestCompletedAt: timestamp("latest_completed_at", { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.environment, t.locationId, t.leadId] }),
  index("ema_ghl_opportunity_owner").on(t.environment, t.locationId, t.opportunityId).where(sql`${t.opportunityId} IS NOT NULL`),
  foreignKey({ name: "ema_ghl_links_case_fk",
    columns: [t.environment, t.locationId, t.contactId, t.opportunityId],
    foreignColumns: [emaGhlCasesTable.environment, emaGhlCasesTable.locationId, emaGhlCasesTable.contactId, emaGhlCasesTable.opportunityId] }),
  check("ema_ghl_links_environment_check", sql`${t.environment} IN ('development','test')`),
]);
export const insertEmaGhlLinkSchema = createInsertSchema(emaGhlLinksTable);
export type EmaGhlLink = typeof emaGhlLinksTable.$inferSelect;
export const emaGhlWorkerLeasesTable = pgTable("ema_ghl_worker_leases", {
  scope: text("scope").primaryKey(),
  token: uuid("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const insertEmaGhlLeaseSchema = createInsertSchema(emaGhlWorkerLeasesTable);
export const emaGhlMutationBarriersTable = pgTable("ema_ghl_mutation_barriers", {
  scope: text("scope").primaryKey(),
  operationId: uuid("operation_id").notNull().references(() => emaGhlOperationsTable.id),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertEmaGhlBarrierSchema = createInsertSchema(emaGhlMutationBarriersTable);