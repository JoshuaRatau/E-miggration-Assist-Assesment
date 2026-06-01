import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

// Support Centre — floating help widget submissions.
//
// Public-facing support requests captured from the floating "Support
// Centre" widget rendered across the app. Intentionally minimal: a
// category, the message, and optional contact details so an operator can
// follow up. No threading, no status workflow — those can be layered on
// later if a full ticketing surface is built in the admin CRM.

export const supportRequestsTable = pgTable("support_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // category ∈ support_query | technical_issue | payment_account | general_question
  category: text("category").notNull(),
  message: text("message").notNull(),
  // Optional so a logged-out visitor can still reach out; an operator
  // replies via whichever channel was provided.
  name: text("name"),
  email: text("email"),
  // Where the request was submitted from (pathname) — aids triage.
  pagePath: text("page_path"),
  status: text("status").notNull().default("new"),
  // Reference assigned by the Eride Support Hub once this request is mirrored
  // there as a ticket (e.g. "EMA-SUP-2026-000012"). Null until the forward
  // succeeds; aids reconciliation between the local row and the hub ticket.
  hubTicketReference: text("hub_ticket_reference"),
  hubSyncedAt: timestamp("hub_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SupportRequest = typeof supportRequestsTable.$inferSelect;
export type InsertSupportRequest = typeof supportRequestsTable.$inferInsert;
