import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * EMA Referral Tunnel — SENDER-side state (this project is the EMA Leads Funnel).
 *
 * These tables track referrals we hand to the separate main EMA operating
 * system over HTTP. We NEVER store applicant PII here — the applicant's
 * identifying details live in `prelaunch_leads` (linked via `leadId`) and are
 * read only at push time to travel inside the signed server-to-server body.
 * Preview fields, tokens, and audit rows must stay non-identifying.
 */

// Partner immigration firms we match referrals to (matching targets).
export const partnerFirmsTable = pgTable("partner_firms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  // Specialties + geographic coverage used by the matcher.
  matterTypes: text("matter_types").array(),
  regions: text("regions").array(),
  // Rough available-slot signal for capacity-aware matching.
  capacity: integer("capacity"),
  // prospect | vetted | suspended
  vettingStatus: text("vetting_status").notNull().default("prospect"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per applicant enquiry offered into the tunnel.
//
// status ∈ offered | preview_viewed | accepted | redirected_to_ema |
//          token_consumed | ema_account_required | ema_account_linked |
//          conflict_check_required | converted | failed | expired
export const referralsTable = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Correlation key shared with EMA (token + push + callback). UNIQUE so the
    // whole tunnel is idempotent by referralId.
    referralId: text("referral_id").notNull().unique(),
    // Our assignment id (echoed back by EMA as `assignmentId`). Optional.
    assignmentId: text("assignment_id").unique(),
    // Soft references (no FK) — PII source + matched firm.
    leadId: uuid("lead_id"),
    funnelFirmId: uuid("funnel_firm_id"),

    status: text("status").notNull().default("offered"),

    // Redacted preview — MUST stay non-identifying.
    matterType: text("matter_type"),
    urgency: text("urgency"),
    region: text("region"),
    summary: text("summary"),

    // POPIA consent to share with partner firms — required before any push.
    consentToShare: boolean("consent_to_share").notNull().default(false),
    consentTextVersion: text("consent_text_version"),
    consentSourcePage: text("consent_source_page"),
    consentIp: text("consent_ip"),
    consentUserAgent: text("consent_user_agent"),
    consentAt: timestamp("consent_at", { withTimezone: true }),

    // Redirect token bookkeeping (one-time-use on our side too).
    tokenNonce: text("token_nonce"),
    tokenIssuedAt: timestamp("token_issued_at", { withTimezone: true }),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    tokenConsumedAt: timestamp("token_consumed_at", { withTimezone: true }),

    // Applicant push bookkeeping.
    pushedAt: timestamp("pushed_at", { withTimezone: true }),

    // Identifiers returned by EMA via the status callback.
    emaFirmId: text("ema_firm_id"),
    emaClientId: text("ema_client_id"),
    emaCaseId: text("ema_case_id"),
    failedReason: text("failed_reason"),
    convertedToEmaCaseAt: timestamp("converted_to_ema_case_at", {
      withTimezone: true,
    }),

    offeredAt: timestamp("offered_at", { withTimezone: true }),
    previewViewedAt: timestamp("preview_viewed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("referrals_status_idx").on(t.status),
    index("referrals_lead_idx").on(t.leadId),
    index("referrals_firm_idx").on(t.funnelFirmId),
  ],
);

// Append-only tunnel audit. Structural facts only — NEVER applicant PII.
export const referralAuditTable = pgTable(
  "referral_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: text("referral_id").notNull(),
    // offered | preview_viewed | accepted | redirected_to_ema |
    // token_consumed | ema_account_required | ema_account_linked |
    // conflict_check_required | converted | failed | expired
    stage: text("stage").notNull(),
    // Non-identifying structural context (ids, reasons, statuses).
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("referral_audit_referral_idx").on(t.referralId, t.createdAt)],
);

export type PartnerFirm = typeof partnerFirmsTable.$inferSelect;
export type InsertPartnerFirm = typeof partnerFirmsTable.$inferInsert;
export type Referral = typeof referralsTable.$inferSelect;
export type InsertReferral = typeof referralsTable.$inferInsert;
export type ReferralAudit = typeof referralAuditTable.$inferSelect;
export type InsertReferralAudit = typeof referralAuditTable.$inferInsert;
