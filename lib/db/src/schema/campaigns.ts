import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Phase 4 — Campaign Engine.
//
// Three tables, intentionally narrow:
//   * `campaigns`           — one row per operator-defined bulk send.
//   * `campaign_recipients` — fan-out, one row per lead per campaign.
//   * `unsubscribes`        — global opt-out registry (per contact value).
//
// Channels supported: email (Resend) and whatsapp (Twilio template + free-form).
// Drips and triggers are explicitly OUT of scope; the schema therefore has no
// notion of campaign_steps / sequences / trigger_type. If those land later
// they will live in a separate `campaign_sequences` table and reference
// campaigns by id, leaving this surface untouched.
//
// All status / channel columns are plain text (not pg enums) — same convention
// as `lead_status` and `engagement.channel` — so adding a new status doesn't
// require a migration dance.

export const campaignsTable = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),

  //   channel  ∈ email | whatsapp
  //   status   ∈ draft | scheduled | sending | paused | completed | cancelled
  // Transitions (enforced at the API layer):
  //   draft     → sending      (POST /:id/send, immediate)
  //   draft     → scheduled    (POST /:id/schedule, with scheduled_at)
  //   scheduled → draft        (POST /:id/unschedule)
  //   scheduled → sending      (scheduler worker, when scheduled_at <= now)
  //   sending   → paused       (POST /:id/pause)
  //   paused    → sending      (POST /:id/resume; re-enqueues queued)
  //   sending   → completed    (worker, when all recipients terminal)
  //   *         → cancelled    (system, on materialise/enqueue failure)
  channel: text("channel").notNull(),
  status: text("status").notNull().default("draft"),

  // Phase 6D-3B — scheduled-send target. Set by POST /:id/schedule (draft
  // → scheduled). The scheduler worker (`lib/campaignScheduleWorker.ts`,
  // 30s tick) claims rows where status='scheduled' AND scheduled_at<=now()
  // and flips them to sending. Cleared on unschedule.
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),

  // Email template fields. Body supports {{first_name}} and {{reference}}
  // merge tokens; the renderer is in `lib/campaignRender.ts`.
  templateSubject: text("template_subject"),
  templateBody: text("template_body"),

  // WhatsApp-only: the operator-picked Twilio Content SID for cold (out-of-
  // window) sends. Inside the 24-hour customer-care window the engine falls
  // back to the free-form `templateBody` rendered as a plain WA text.
  whatsappTemplateSid: text("whatsapp_template_sid"),

  // Audience query — see `lib/audienceQuery.ts` for the validated shape
  // (`AudienceQuery` zod schema). Stored as jsonb so the editor can round-trip
  // the rule tree losslessly without a per-rule normalization layer.
  audienceFilter: jsonb("audience_filter"),

  // Snapshotted at the moment "Send" was clicked. Distinct from
  // `recipientsTotal` because the audience filter could match new leads
  // created AFTER the campaign was sent — the snapshot freezes attribution.
  audienceSnapshotCount: integer("audience_snapshot_count").notNull().default(0),

  // Aggregates for the dashboard list page. Updated transactionally as each
  // recipient row flips state — saves a per-row COUNT() query when rendering.
  recipientsTotal: integer("recipients_total").notNull().default(0),
  recipientsSent: integer("recipients_sent").notNull().default(0),
  recipientsFailed: integer("recipients_failed").notNull().default(0),
  recipientsSkipped: integer("recipients_skipped").notNull().default(0),
  recipientsUnsubscribed: integer("recipients_unsubscribed")
    .notNull()
    .default(0),

  // Authoring metadata. `createdBy` is the admin_users.id from the cookie
  // session (no FK so a soft-deleted admin doesn't break the row).
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const campaignRecipientsTable = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id").notNull(),
    leadId: uuid("lead_id").notNull(),

    //   status  ∈ queued | sent | failed | skipped | unsubscribed
    // `queued` exists for symmetry with a future async worker; the V1 sync
    // sender writes terminal states directly.
    status: text("status").notNull().default("queued"),

    // For non-`sent` rows: a short machine-readable reason
    // (e.g. "no_recipient", "unsubscribed", "wa_out_of_window_no_template").
    reason: text("reason"),

    // The engagement row this recipient produced (if any) — feeds the
    // per-lead timeline in Phase 3 and lets the Campaign detail page
    // deep-link into the lead's full engagement history.
    engagementId: uuid("engagement_id"),

    //   channelUsed ∈ email | whatsapp_template | whatsapp_freeform
    // Records which delivery path was actually taken so reporting can split
    // WA template vs in-window free-form without a second join.
    channelUsed: text("channel_used"),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Re-running a campaign on the same audience must be idempotent; a
    // duplicate (campaign, lead) pair is a programmer error.
    uniqRecipient: uniqueIndex("campaign_recipients_campaign_lead_uniq").on(
      t.campaignId,
      t.leadId,
    ),
  }),
);

export const unsubscribesTable = pgTable(
  "unsubscribes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    //   contactType ∈ email | whatsapp
    // Per-channel because a lead might unsubscribe from email but still
    // accept WhatsApp updates (or vice versa). The audience compiler
    // checks the registry with the channel of the campaign.
    contactType: text("contact_type").notNull(),

    // Canonicalized: email lower-cased + trimmed; WhatsApp normalized to
    // E.164 with leading '+'. Always pass through `canonicalContact()`
    // (see `lib/unsubscribe.ts`) — never insert raw user input.
    contact: text("contact").notNull(),

    //   source ∈ link | wa_stop | manual | operator
    source: text("source").notNull(),
    reason: text("reason"),

    // Operator id when source = 'operator' (admin manually unsubscribed
    // a contact via the dashboard). NULL for self-service unsubscribes.
    unsubscribedBy: uuid("unsubscribed_by"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // The same contact unsubscribing twice is a no-op; the API treats a
    // unique-violation on insert as success.
    uniqContact: uniqueIndex("unsubscribes_type_contact_uniq").on(
      t.contactType,
      t.contact,
    ),
  }),
);

export type Campaign = typeof campaignsTable.$inferSelect;
export type InsertCampaign = typeof campaignsTable.$inferInsert;
export type CampaignRecipient = typeof campaignRecipientsTable.$inferSelect;
export type InsertCampaignRecipient = typeof campaignRecipientsTable.$inferInsert;
export type Unsubscribe = typeof unsubscribesTable.$inferSelect;
export type InsertUnsubscribe = typeof unsubscribesTable.$inferInsert;
