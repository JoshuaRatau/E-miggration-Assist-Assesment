import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  numeric,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Meta (Facebook/Instagram) integration — Phase M1.
//
// Design notes:
//   * Single-tenant (EMA has no organisation model), so `meta_connections`
//     is expected to hold at most ONE active row. The unique partial index
//     is approximated with a plain status column + app-layer guard, same
//     convention as lead_status (plain text, no pg enums).
//   * Access tokens are stored ENCRYPTED (AES-256-GCM, key derived from
//     SESSION_SECRET) — never plaintext. See api-server services/meta/crypto.
//   * `meta_insights_daily` is the historical metric store. Uniqueness on
//     (account_type, account_id, metric_name, metric_date, period, breakdown_key)
//     makes repeated syncs idempotent (upsert, never duplicate).
//   * All Meta object ids are text (Meta ids exceed int53 in some surfaces).

export const metaConnectionsTable = pgTable("meta_connections", {
  id: uuid("id").primaryKey().defaultRandom(),

  metaUserId: text("meta_user_id"),
  businessId: text("business_id"),
  facebookPageId: text("facebook_page_id"),
  facebookPageName: text("facebook_page_name"),
  instagramAccountId: text("instagram_account_id"),
  instagramUsername: text("instagram_username"),

  // AES-256-GCM ciphertext (base64: iv.tag.data). User long-lived token +
  // page token stored separately because Graph calls need the page token
  // for page/IG insights and the user token for ad-account surfaces.
  userTokenEncrypted: text("user_token_encrypted"),
  pageTokenEncrypted: text("page_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),

  adAccountId: text("ad_account_id"),
  adAccountName: text("ad_account_name"),

  grantedScopes: jsonb("granted_scopes"),

  // status ∈ active | token_expired | disconnected | error
  status: text("status").notNull().default("active"),
  lastError: text("last_error"),

  connectedByUserId: uuid("connected_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const metaSyncRunsTable = pgTable(
  "meta_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull(),
    // trigger ∈ manual | scheduled | webhook
    trigger: text("trigger").notNull().default("manual"),
    // status ∈ running | success | partial | failed
    status: text("status").notNull().default("running"),
    // Per-section outcome map, e.g. {"pages":"ok","campaigns":"rate_limited"}
    sections: jsonb("sections"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("meta_sync_runs_started_idx").on(t.startedAt)],
);

export const metaInsightsDailyTable = pgTable(
  "meta_insights_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // account_type ∈ facebook_page | instagram | ad_account
    accountType: text("account_type").notNull(),
    accountId: text("account_id").notNull(),
    metricName: text("metric_name").notNull(),
    metricValue: numeric("metric_value"),
    // Non-numeric / breakdown payloads (e.g. demographics maps).
    metricBreakdown: jsonb("metric_breakdown"),
    // Discriminator for breakdown rows sharing metric+date ('' = total).
    breakdownKey: text("breakdown_key").notNull().default(""),
    metricDate: text("metric_date").notNull(), // YYYY-MM-DD
    // period ∈ day | lifetime
    period: text("period").notNull().default("day"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_insights_daily_uniq").on(
      t.accountType,
      t.accountId,
      t.metricName,
      t.metricDate,
      t.period,
      t.breakdownKey,
    ),
    index("meta_insights_daily_date_idx").on(t.metricDate),
  ],
);

export const metaCampaignsTable = pgTable(
  "meta_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    adAccountId: text("ad_account_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    objective: text("objective"),
    startTime: timestamp("start_time", { withTimezone: true }),
    stopTime: timestamp("stop_time", { withTimezone: true }),
    // Lifetime aggregates from the Insights API (refreshed each sync).
    spend: numeric("spend"),
    impressions: bigint("impressions", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    clicks: bigint("clicks", { mode: "number" }),
    ctr: numeric("ctr"),
    cpc: numeric("cpc"),
    cpm: numeric("cpm"),
    leads: integer("leads"),
    costPerLead: numeric("cost_per_lead"),
    conversions: integer("conversions"),
    costPerConversion: numeric("cost_per_conversion"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("meta_campaigns_meta_id_uniq").on(t.metaCampaignId)],
);

export const metaAdSetsTable = pgTable(
  "meta_ad_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaAdSetId: text("meta_ad_set_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    spend: numeric("spend"),
    impressions: bigint("impressions", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    clicks: bigint("clicks", { mode: "number" }),
    leads: integer("leads"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("meta_ad_sets_meta_id_uniq").on(t.metaAdSetId)],
);

export const metaAdsTable = pgTable(
  "meta_ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaAdId: text("meta_ad_id").notNull(),
    metaAdSetId: text("meta_ad_set_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    spend: numeric("spend"),
    impressions: bigint("impressions", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    clicks: bigint("clicks", { mode: "number" }),
    leads: integer("leads"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("meta_ads_meta_id_uniq").on(t.metaAdId)],
);

export const metaLeadFormsTable = pgTable(
  "meta_lead_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaFormId: text("meta_form_id").notNull(),
    pageId: text("page_id").notNull(),
    name: text("name"),
    status: text("status"),
    questions: jsonb("questions"),
    leadsCount: integer("leads_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("meta_lead_forms_meta_id_uniq").on(t.metaFormId)],
);

export const metaLeadsTable = pgTable(
  "meta_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaLeadId: text("meta_lead_id").notNull(),
    pageId: text("page_id"),
    instagramAccountId: text("instagram_account_id"),
    metaCampaignId: text("meta_campaign_id"),
    metaAdSetId: text("meta_ad_set_id"),
    metaAdId: text("meta_ad_id"),
    metaFormId: text("meta_form_id"),
    // platform ∈ facebook | instagram | messenger | unknown
    platform: text("platform").notNull().default("unknown"),
    fullName: text("full_name"),
    email: text("email"),
    phone: text("phone"),
    // Raw field_data answers as supplied by Meta (sanitized before display).
    fieldData: jsonb("field_data"),
    metaCreatedAt: timestamp("meta_created_at", { withTimezone: true }),
    // Link into the CRM (prelaunch_leads.id) once imported. Nullable —
    // import can fail (e.g. no contact info) without losing the Meta row.
    crmLeadId: uuid("crm_lead_id"),
    // import_status ∈ imported | duplicate | skipped_no_contact | error
    importStatus: text("import_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_leads_meta_id_uniq").on(t.metaLeadId),
    index("meta_leads_created_idx").on(t.metaCreatedAt),
  ],
);

export const metaContentInsightsTable = pgTable(
  "meta_content_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaContentId: text("meta_content_id").notNull(),
    // platform ∈ facebook | instagram
    platform: text("platform").notNull(),
    // content_type ∈ post | image | video | reel | story | link | other
    contentType: text("content_type").notNull().default("other"),
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"),
    caption: text("caption"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    views: bigint("views", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    interactions: integer("interactions"),
    videoViews: bigint("video_views", { mode: "number" }),
    watchTimeMs: bigint("watch_time_ms", { mode: "number" }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_content_insights_meta_id_uniq").on(t.metaContentId),
    index("meta_content_published_idx").on(t.publishedAt),
  ],
);

export const metaWebhookEventsTable = pgTable(
  "meta_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Dedupe key: for leadgen events `leadgen:<leadgen_id>`; otherwise a
    // hash of the raw payload. Retried webhook deliveries hit the unique
    // index and are ignored — idempotent by construction.
    dedupeKey: text("dedupe_key").notNull(),
    object: text("object"),
    field: text("field"),
    payload: jsonb("payload"),
    // status ∈ received | processed | failed | ignored
    status: text("status").notNull().default("received"),
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("meta_webhook_events_dedupe_uniq").on(t.dedupeKey)],
);

export type MetaConnection = typeof metaConnectionsTable.$inferSelect;
export type MetaSyncRun = typeof metaSyncRunsTable.$inferSelect;
export type MetaInsightDaily = typeof metaInsightsDailyTable.$inferSelect;
export type MetaCampaign = typeof metaCampaignsTable.$inferSelect;
export type MetaAdSet = typeof metaAdSetsTable.$inferSelect;
export type MetaAd = typeof metaAdsTable.$inferSelect;
export type MetaLeadForm = typeof metaLeadFormsTable.$inferSelect;
export type MetaLead = typeof metaLeadsTable.$inferSelect;
export type MetaContentInsight = typeof metaContentInsightsTable.$inferSelect;
export type MetaWebhookEvent = typeof metaWebhookEventsTable.$inferSelect;
