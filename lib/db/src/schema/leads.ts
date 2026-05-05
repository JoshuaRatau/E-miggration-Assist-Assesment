import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
} from "drizzle-orm/pg-core";

export const prelaunchLeadsTable = pgTable("prelaunch_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceNumber: text("reference_number").notNull().unique(),
  fullName: text("full_name"),
  email: text("email"),
  whatsapp: text("whatsapp"),
  nationality: text("nationality"),
  countryOfResidence: text("country_of_residence"),
  currentlyInSouthAfrica: boolean("currently_in_south_africa"),
  passportStatus: text("passport_status"),
  visaHistory: text("visa_history"),
  immigrationSituation: text("immigration_situation"),
  visaExpiryDate: date("visa_expiry_date"),
  exitDate: date("exit_date"),
  borderDocumentIssued: text("border_document_issued"),
  overstayReason: text("overstay_reason"),
  hasSupportingDocuments: text("has_supporting_documents"),
  previousOverstay: text("previous_overstay"),
  internalClassification: text("internal_classification"),
  leadScore: integer("lead_score"),
  leadCategory: text("lead_category"),
  // Business CRM fields. Lowercase canonical enums (see classification.ts):
  //   leadStatus   ∈ {new, reviewing, contacted, converted, closed}
  //   leadPriority ∈ {high, medium, low}
  // adminNotes holds internal-only operator notes (never exposed publicly).
  leadPriority: text("lead_priority").default("medium"),
  leadStatus: text("lead_status").notNull().default("new"),
  adminNotes: text("admin_notes"),
  preferredContactMethod: text("preferred_contact_method"),
  consentAccepted: boolean("consent_accepted").notNull().default(false),
  consentTimestamp: timestamp("consent_timestamp", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const prelaunchDocumentsTable = pgTable("prelaunch_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull(),
  documentType: text("document_type").notNull(),
  // fileUrl stores the object storage path (e.g. /objects/uploads/<uuid>)
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  uploadStatus: text("upload_status").notNull().default("UPLOADED"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsEventsTable = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventName: text("event_name").notNull(),
  leadId: uuid("lead_id"),
  referenceNumber: text("reference_number"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Lead Engagements ------------------------------------------------------------
//
// One row per outbound message attempt to a lead. Drives the admin engagement
// history UI and is also a future hand-off point for non-email channels
// (WhatsApp first). Channel/type/status are stored as plain text rather than
// pg enums so adding e.g. 'sms' or 'in_app' later does not require a migration
// dance — the application layer is the source of truth.
//
//   channel ∈ email | whatsapp
//   type    ∈ confirmation | update | manual
//   status  ∈ pending | sent | failed
//
// `message` is nullable: confirmation and "send update batch" rows use a
// templated body and do not store the rendered text. Manual messages typed by
// an admin ARE persisted so the operator can audit what was sent.
export const leadEngagementsTable = pgTable("lead_engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull(),
  channel: text("channel").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Case Messages -------------------------------------------------------------
//
// One row per INBOUND message received from a contact (initially WhatsApp).
// "case" in the spec refers to a lead — there is no separate cases table —
// so leadId is the FK-style reference to prelaunch_leads.id.
//
//   direction       ∈ inbound        (outbound deliveries are tracked in
//                                     lead_engagements; this table is
//                                     reserved for replies coming TO us)
//   intent          ∈ task_complete_signal | null
//                     (deterministic Phase-1 classification — no LLM yet)
//   matchedKeyword  the literal keyword that fired the intent ("done",
//                   "uploaded", "sent", …) — useful for audit/replay.
//   waMessageId     Meta wamid; UNIQUE so duplicate webhook deliveries from
//                   Meta (which retries aggressively on non-2xx) cannot
//                   create duplicate rows.  Nullable for non-WhatsApp
//                   future channels.
export const caseMessagesTable = pgTable("case_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull(),
  direction: text("direction").notNull(),
  waMessageId: text("wa_message_id").unique(),
  message: text("message").notNull(),
  intent: text("intent"),
  matchedKeyword: text("matched_keyword"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PrelaunchLead = typeof prelaunchLeadsTable.$inferSelect;
export type InsertPrelaunchLead = typeof prelaunchLeadsTable.$inferInsert;
export type PrelaunchDocument = typeof prelaunchDocumentsTable.$inferSelect;
export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;
export type LeadEngagement = typeof leadEngagementsTable.$inferSelect;
export type InsertLeadEngagement = typeof leadEngagementsTable.$inferInsert;
export type CaseMessage = typeof caseMessagesTable.$inferSelect;
export type InsertCaseMessage = typeof caseMessagesTable.$inferInsert;
