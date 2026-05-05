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
  // Business CRM fields
  leadPriority: text("lead_priority"),
  leadStatus: text("lead_status").notNull().default("NEW"),
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
  fileUrl: text("file_url").notNull(),
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

export type PrelaunchLead = typeof prelaunchLeadsTable.$inferSelect;
export type InsertPrelaunchLead = typeof prelaunchLeadsTable.$inferInsert;
export type PrelaunchDocument = typeof prelaunchDocumentsTable.$inferSelect;
export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;
