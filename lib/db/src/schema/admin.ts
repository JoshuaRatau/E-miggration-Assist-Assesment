import { pgTable, text, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

export const adminUsersTable = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  isActive: boolean("is_active").notNull().default(true),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  // CRM Phase A: explicit RBAC role. Coexists with `isSuperadmin` for
  // back-compat (the boolean stays the source of truth for the existing
  // gateSuperadmin() check; `role` becomes the source of truth in Phase E
  // when finer-grained permission gates land).
  //   role ∈ {superadmin, admin, sales, operations, viewer}
  // Backfilled at migration time: isSuperadmin=true → "superadmin",
  // isSuperadmin=false → "admin".
  role: text("role").notNull().default("admin"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adminSessionsTable = pgTable("admin_sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adminPasswordResetsTable = pgTable("admin_password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AdminUser = typeof adminUsersTable.$inferSelect;
export type InsertAdminUser = typeof adminUsersTable.$inferInsert;
export type AdminSession = typeof adminSessionsTable.$inferSelect;
export type InsertAdminSession = typeof adminSessionsTable.$inferInsert;
export type AdminPasswordReset = typeof adminPasswordResetsTable.$inferSelect;
export type InsertAdminPasswordReset =
  typeof adminPasswordResetsTable.$inferInsert;
