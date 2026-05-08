import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

// Phase 5 Phase E — Draft Templates (§3.C).
//
// Reusable message bodies that operators can author once and then load
// into a campaign or one-to-one outreach. Intentionally minimal: no
// versioning, no folder structure, no preview-link tokens beyond the
// existing `lib/campaignRender.ts` vocabulary.
//
// Soft-delete via `archivedAt` so a template referenced in a past
// campaign's audit trail (or an in-flight draft) doesn't 404 the
// editor's "Load from template" picker.

export const commTemplatesTable = pgTable("comm_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // category ∈ promotional | system_update | new_feature | educational | customer_experience
  category: text("category").notNull(),
  // channel ∈ email | whatsapp
  channel: text("channel").notNull(),
  // Email-only. NULL for whatsapp templates.
  subject: text("subject"),
  body: text("body").notNull(),

  // Authoring metadata. UUIDs are soft references to admin_users.id so
  // a deleted admin doesn't break the row (same convention as
  // campaigns.createdBy).
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Soft delete. Archived templates stay listable behind a query flag
  // and remain referenceable for historical context, but are excluded
  // from the default picker.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export type CommTemplate = typeof commTemplatesTable.$inferSelect;
export type InsertCommTemplate = typeof commTemplatesTable.$inferInsert;
