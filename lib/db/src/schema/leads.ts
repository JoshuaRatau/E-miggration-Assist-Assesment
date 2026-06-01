import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
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
  //   leadStatus   ∈ {new, reviewing, contacted, engaged,
  //                   qualified, proposal_sent, ready_for_case, converted,
  //                   closed}. Phase 5 §10 made the funnel BIDIRECTIONAL;
  //                   the only remaining hard invariant is the `converted`
  //                   predecessor lock (must come from ready_for_case).
  //                   Phase 6A.1 dropped `awaiting_response` — that
  //                   "waiting" state is now `contacted + next_follow_up_at`.
  //   leadPriority ∈ {critical, high, medium, low}
  // adminNotes holds internal-only operator notes (never exposed publicly).
  leadPriority: text("lead_priority").default("medium"),
  leadStatus: text("lead_status").notNull().default("new"),
  adminNotes: text("admin_notes"),
  preferredContactMethod: text("preferred_contact_method"),
  consentAccepted: boolean("consent_accepted").notNull().default(false),
  consentTimestamp: timestamp("consent_timestamp", { withTimezone: true }),

  // ── CRM Phase A: dual-lead architecture (B2C / B2B) ───────────────────────
  //
  // `leadType` discriminates between Individual (public assessment form) and
  // Professional (CSV/XLSX import or future API integrations). All historical
  // rows are backfilled to "individual" via a one-shot UPDATE after migration.
  //   leadType ∈ {individual, professional}
  //
  // `inquiryType` is meaningful only for individual leads (null for professional).
  //   inquiryType ∈ {visa_inquiry, overstay_appeal, travel_entry_assistance}
  //
  // `source` tracks where the lead originated (web_form, csv_import, manual,
  // future api). Backfilled to "web_form" for historical rows.
  //
  // `assignedTo` references admin_users.id — no FK constraint enforced here
  // because Drizzle/drizzle-kit push without a foreign-key declaration keeps
  // the migration trivial; soft-deletes are checked at the API layer.
  leadType: text("lead_type").notNull().default("individual"),
  inquiryType: text("inquiry_type"),
  // `source` is the channel — web_form (public assessment), referral,
  // linkedin, facebook, google, direct, csv_import, manual, api, other.
  // The application layer is the source of truth for the allow-list; we
  // stay on plain `text` so adding a channel doesn't need a migration.
  source: text("source").default("web_form"),
  // `sourceCampaign` is a free-text utm-style identifier captured at
  // submission time (e.g. "spring_overstay_2026", "linkedin_post_april").
  // Phase 2 of the comms-architecture rollout — surfaced in the admin
  // dashboard as an attribution sub-label under the source badge.
  sourceCampaign: text("source_campaign"),
  assignedTo: uuid("assigned_to"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  tags: text("tags").array(),

  // ── Professional-lead (B2B) fields ───────────────────────────────────────
  // All NULL for individual leads. Populated by the import pipeline (Phase B)
  // and by the manual "create professional lead" admin form (Phase D).
  //   organizationType ∈ {law_firm, immigration_consultancy,
  //                       global_mobility, independent_practitioner}
  organizationName: text("organization_name"),
  organizationType: text("organization_type"),
  representativeName: text("representative_name"),
  representativeEmail: text("representative_email"),
  representativePhone: text("representative_phone"),
  // Phase 6A — B2B contact intelligence. Free-text job title (e.g.
  // "Managing Partner", "Operations Administrator") and relationship
  // classifier (e.g. "Primary Decision Maker", "General Operations
  // Contact", "Departmental Contact"). Both NULL by default; populated
  // by the import pipeline / manual edit. The dashboard hover-card
  // falls back to a heuristic derivation when these are NULL so the
  // tooltip always renders useful copy.
  // Phase 6A.5 — Tier-aware lead intent. Nullable text column carrying the
  // commercial tier the lead is heading toward, drawn from the SaaS pricing
  // ladder. Allowed values (enforced at the API layer, not the DB, so adding
  // a tier doesn't need a migration):
  //   B2C self-serve: free, basic, plus, pro, premium
  //   B2B firm:       starter_firm, growth_firm, scale_firm, enterprise
  //   White-glove:    concierge
  //   Sentinel:       unknown
  // NULL means "not yet classified" (the default for legacy rows and any
  // row created before the operator picks a tier). Foundational for the
  // tier-aware scoring rubric (Phase 6B) and SLA tracker (Phase 6D).
  intendedTier: text("intended_tier"),
  // ── Phase 6B — Tier-aware lead scoring ──────────────────────────────────
  // The canonical numeric score still lives in `leadScore` above (kept as
  // the indexable sort/filter column for back-compat). These three columns
  // hold the ancillary metadata produced by the recompute worker.
  //
  //   leadScoreBreakdown   jsonb array of { rule, points, occurredAt? }
  //                        rendered in the LeadScoreBadge tooltip and the
  //                        lead-detail Activity panel. Null until the
  //                        worker runs the first time for this lead — the
  //                        legacy static derivation in lib/leadScore.ts is
  //                        used as a fallback.
  //   leadScoreComputedAt  Timestamp of the most recent recompute. The
  //                        worker uses (max(lead_events.occurred_at) >
  //                        computed_at) as the dirty predicate.
  //   leadScoreRubric      Which rubric was applied: 'self_serve' | 'sales'
  //                        | 'static'. Picked from intended_tier motion;
  //                        null/unknown tier → 'static'.
  leadScoreBreakdown: jsonb("lead_score_breakdown").$type<
    Array<{ rule: string; points: number; occurrences: number }>
  >(),
  leadScoreComputedAt: timestamp("lead_score_computed_at", {
    withTimezone: true,
  }),
  leadScoreRubric: text("lead_score_rubric"),
  representativeRole: text("representative_role"),
  representativeRelationship: text("representative_relationship"),
  website: text("website"),
  firmSize: text("firm_size"),
  operatingRegions: text("operating_regions").array(),
  serviceFocus: text("service_focus"),
  estimatedClientVolume: integer("estimated_client_volume"),

  // Soft-archive. NULL = active (shown in the funnel by default); a non-null
  // timestamp removes the lead from the default leads list while preserving
  // the row + all related data so it can be restored. Hard deletion is a
  // separate, permanent operation (DELETE /api/admin/leads/:id).
  archivedAt: timestamp("archived_at", { withTimezone: true }),

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

// Lead OTPs ------------------------------------------------------------
//
// Pre-submission verification rows. Created on POST /api/otp/request and
// consumed on POST /api/otp/verify. The verification result is then attached
// to lead creation via `verifiedOtpId` in the body — server enforces that
// the verified contact (email OR canonical whatsapp) matches the lead.
//
//   channel ∈ email | whatsapp
//   codeHash = sha256(code) hex; raw code is NEVER stored.
//   attempts caps verification tries at 5 (anti-bruteforce).
//   expiresAt = createdAt + 10 minutes.
//   consumedAt set when a verify succeeds; row becomes a one-shot proof.
//
// Rows are NOT cleaned up by the application (operator/cron concern).
export const leadOtpsTable = pgTable("lead_otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  email: text("email"),
  whatsapp: text("whatsapp"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LeadOtp = typeof leadOtpsTable.$inferSelect;
export type InsertLeadOtp = typeof leadOtpsTable.$inferInsert;

// Lead Audit ----------------------------------------------------------------
//
// Append-only admin action log used for compliance / forensics. Every
// privileged mutation (status change, priority change, notes change, lead
// → case conversion, case status change, document download, manual contact
// click, outbound message send attempt) writes one row.
//
//   actorTokenHash  sha256 hex of the credential used (cookie session id
//                   for V3 auth, or raw x-admin-token for legacy callers).
//                   The raw credential is NEVER stored.
//   action          short snake_case verb identifying what happened.
//   before / after  JSONB snapshots of the relevant fields, scoped to the
//                   minimum needed to reconstruct the change.
export const leadAuditTable = pgTable("lead_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id"),
  caseId: uuid("case_id"),
  actorTokenHash: text("actor_token_hash"),
  // CRM Phase A: when the request was made via cookie session auth, we ALSO
  // record the admin_users.id so the timeline UI can render "Jane updated
  // status" without reversing the hash. Null for legacy x-admin-token callers
  // (which by design have no identifiable user).
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LeadAudit = typeof leadAuditTable.$inferSelect;
export type InsertLeadAudit = typeof leadAuditTable.$inferInsert;

// Lead Events --------------------------------------------------------------
//
// Append-only event stream that drives Phase 6B tier-aware scoring. Distinct
// from `lead_audit`:
//   - `lead_audit`  records WHO did WHAT to a lead (operator forensics).
//   - `lead_events` records SIGNALS used to score the lead (system + webhook
//     + operator events that move the score needle).
//
// Rows are written by `recordLeadEvent()` from system code paths
// (POST /api/leads, finalize, PATCH admin/leads/:id) and from webhook
// receivers (Resend/Twilio in Phase 6E). The recompute worker reads them
// on its 60-second tick and overwrites `prelaunch_leads.lead_score` +
// `lead_score_breakdown` + `lead_score_computed_at`.
//
//   type        snake_case event verb (e.g. 'lead_created',
//               'documents_uploaded', 'demo_requested', 'email_opened').
//               The rubric definitions in `scoringRubrics.ts` map type →
//               points.
//   points      Authoritative point value for this event under the rubric
//               that applied at write-time. Stored on the row so a later
//               rubric tweak doesn't silently rewrite history.
//   rubric      Which rubric emitted this row ('self_serve' | 'sales' |
//               'static'). Useful for filtering when a lead's tier flips.
//   source      'system' | 'webhook' | 'operator'.
export const leadEventsTable = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull(),
    type: text("type").notNull(),
    points: integer("points").notNull().default(0),
    rubric: text("rubric"),
    payload: jsonb("payload"),
    source: text("source").notNull().default("system"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Powers the recompute worker's dirty-predicate scan:
    //   WHERE lead_id = ? AND occurred_at > computed_at
    // Without this index the scan degrades to a seq scan that grows with
    // the entire event log.
    leadOccurredIdx: index("lead_events_lead_occurred_idx").on(
      t.leadId,
      t.occurredAt,
    ),
  }),
);

export type LeadEvent = typeof leadEventsTable.$inferSelect;
export type InsertLeadEvent = typeof leadEventsTable.$inferInsert;

export type PrelaunchLead = typeof prelaunchLeadsTable.$inferSelect;
export type InsertPrelaunchLead = typeof prelaunchLeadsTable.$inferInsert;
export type PrelaunchDocument = typeof prelaunchDocumentsTable.$inferSelect;
export type AnalyticsEvent = typeof analyticsEventsTable.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEventsTable.$inferInsert;
export type LeadEngagement = typeof leadEngagementsTable.$inferSelect;
export type InsertLeadEngagement = typeof leadEngagementsTable.$inferInsert;
export type CaseMessage = typeof caseMessagesTable.$inferSelect;
export type InsertCaseMessage = typeof caseMessagesTable.$inferInsert;
