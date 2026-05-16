import { pgTable, uniqueIndex, uuid, text, boolean, jsonb, integer, timestamp, unique, index, date } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const lifecycleRules = pgTable("lifecycle_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	enabled: boolean().default(false).notNull(),
	triggerType: text("trigger_type").notNull(),
	triggerConfig: jsonb("trigger_config"),
	conditions: jsonb(),
	actionType: text("action_type").notNull(),
	actionConfig: jsonb("action_config"),
	delayMinutes: integer("delay_minutes").default(0).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("lifecycle_rules_name_uniq").using("btree", table.name.asc().nullsLast().op("text_ops")),
]);

export const analyticsEvents = pgTable("analytics_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventName: text("event_name").notNull(),
	leadId: uuid("lead_id"),
	referenceNumber: text("reference_number"),
	payload: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const caseMessages = pgTable("case_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	direction: text().notNull(),
	waMessageId: text("wa_message_id"),
	message: text().notNull(),
	intent: text(),
	matchedKeyword: text("matched_keyword"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("case_messages_wa_message_id_unique").on(table.waMessageId),
]);

export const leadAudit = pgTable("lead_audit", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id"),
	caseId: uuid("case_id"),
	actorTokenHash: text("actor_token_hash"),
	actorUserId: uuid("actor_user_id"),
	action: text().notNull(),
	before: jsonb(),
	after: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const leadEngagements = pgTable("lead_engagements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	channel: text().notNull(),
	type: text().notNull(),
	status: text().default('pending').notNull(),
	message: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const leadEvents = pgTable("lead_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	type: text().notNull(),
	points: integer().default(0).notNull(),
	rubric: text(),
	payload: jsonb(),
	source: text().default('system').notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("lead_events_lead_occurred_idx").using("btree", table.leadId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const leadOtps = pgTable("lead_otps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	channel: text().notNull(),
	email: text(),
	whatsapp: text(),
	codeHash: text("code_hash").notNull(),
	attempts: integer().default(0).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const prelaunchDocuments = pgTable("prelaunch_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	documentType: text("document_type").notNull(),
	fileUrl: text("file_url").notNull(),
	fileName: text("file_name"),
	mimeType: text("mime_type"),
	fileSize: integer("file_size"),
	uploadStatus: text("upload_status").default('UPLOADED').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const prelaunchLeads = pgTable("prelaunch_leads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	referenceNumber: text("reference_number").notNull(),
	fullName: text("full_name"),
	email: text(),
	whatsapp: text(),
	nationality: text(),
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
	leadPriority: text("lead_priority").default('medium'),
	leadStatus: text("lead_status").default('new').notNull(),
	adminNotes: text("admin_notes"),
	preferredContactMethod: text("preferred_contact_method"),
	consentAccepted: boolean("consent_accepted").default(false).notNull(),
	consentTimestamp: timestamp("consent_timestamp", { withTimezone: true, mode: 'string' }),
	leadType: text("lead_type").default('individual').notNull(),
	inquiryType: text("inquiry_type"),
	source: text().default('web_form'),
	sourceCampaign: text("source_campaign"),
	assignedTo: uuid("assigned_to"),
	lastContactedAt: timestamp("last_contacted_at", { withTimezone: true, mode: 'string' }),
	nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true, mode: 'string' }),
	tags: text().array(),
	organizationName: text("organization_name"),
	organizationType: text("organization_type"),
	representativeName: text("representative_name"),
	representativeEmail: text("representative_email"),
	representativePhone: text("representative_phone"),
	intendedTier: text("intended_tier"),
	leadScoreBreakdown: jsonb("lead_score_breakdown"),
	leadScoreComputedAt: timestamp("lead_score_computed_at", { withTimezone: true, mode: 'string' }),
	leadScoreRubric: text("lead_score_rubric"),
	representativeRole: text("representative_role"),
	representativeRelationship: text("representative_relationship"),
	website: text(),
	firmSize: text("firm_size"),
	operatingRegions: text("operating_regions").array(),
	serviceFocus: text("service_focus"),
	estimatedClientVolume: integer("estimated_client_volume"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("prelaunch_leads_reference_number_unique").on(table.referenceNumber),
]);

export const leadCases = pgTable("lead_cases", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	referenceNumber: text("reference_number").notNull(),
	status: text().default('initiated').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("lead_cases_lead_id_unique").on(table.leadId),
]);

export const adminPasswordResets = pgTable("admin_password_resets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("admin_password_resets_token_hash_unique").on(table.tokenHash),
]);

export const adminSessions = pgTable("admin_sessions", {
	id: text().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const adminUsers = pgTable("admin_users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	displayName: text("display_name"),
	isActive: boolean("is_active").default(true).notNull(),
	isSuperadmin: boolean("is_superadmin").default(false).notNull(),
	role: text().default('admin').notNull(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	createdById: uuid("created_by_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("admin_users_email_unique").on(table.email),
]);

export const importJobRows = pgTable("import_job_rows", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	rowIndex: integer("row_index").notNull(),
	raw: jsonb().notNull(),
	parsed: jsonb(),
	status: text().default('pending').notNull(),
	errors: jsonb(),
	resolvedLeadId: uuid("resolved_lead_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const importJobs = pgTable("import_jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	uploadedBy: uuid("uploaded_by"),
	sourceFilename: text("source_filename").notNull(),
	fileSizeBytes: integer("file_size_bytes").notNull(),
	mime: text().notNull(),
	leadType: text("lead_type").notNull(),
	status: text().default('uploaded').notNull(),
	columnMapping: jsonb("column_mapping"),
	dedupeStrategy: text("dedupe_strategy"),
	errorSummary: jsonb("error_summary"),
	rowsTotal: integer("rows_total").default(0).notNull(),
	rowsValid: integer("rows_valid").default(0).notNull(),
	rowsInvalid: integer("rows_invalid").default(0).notNull(),
	rowsImported: integer("rows_imported").default(0).notNull(),
	rowsUpdated: integer("rows_updated").default(0).notNull(),
	rowsSkippedDuplicate: integer("rows_skipped_duplicate").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
});

export const campaignRecipients = pgTable("campaign_recipients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	status: text().default('queued').notNull(),
	reason: text(),
	engagementId: uuid("engagement_id"),
	channelUsed: text("channel_used"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("campaign_recipients_campaign_lead_uniq").using("btree", table.campaignId.asc().nullsLast().op("uuid_ops"), table.leadId.asc().nullsLast().op("uuid_ops")),
]);

export const campaigns = pgTable("campaigns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	channel: text().notNull(),
	status: text().default('draft').notNull(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	templateSubject: text("template_subject"),
	templateBody: text("template_body"),
	whatsappTemplateSid: text("whatsapp_template_sid"),
	audienceFilter: jsonb("audience_filter"),
	audienceSnapshotCount: integer("audience_snapshot_count").default(0).notNull(),
	recipientsTotal: integer("recipients_total").default(0).notNull(),
	recipientsSent: integer("recipients_sent").default(0).notNull(),
	recipientsFailed: integer("recipients_failed").default(0).notNull(),
	recipientsSkipped: integer("recipients_skipped").default(0).notNull(),
	recipientsUnsubscribed: integer("recipients_unsubscribed").default(0).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
});

export const unsubscribes = pgTable("unsubscribes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contactType: text("contact_type").notNull(),
	contact: text().notNull(),
	source: text().notNull(),
	reason: text(),
	unsubscribedBy: uuid("unsubscribed_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("unsubscribes_type_contact_uniq").using("btree", table.contactType.asc().nullsLast().op("text_ops"), table.contact.asc().nullsLast().op("text_ops")),
]);

export const commTemplates = pgTable("comm_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	category: text().notNull(),
	channel: text().notNull(),
	subject: text(),
	body: text().notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
});

export const billingIngestEvents = pgTable("billing_ingest_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	externalEventId: text("external_event_id").notNull(),
	eventType: text("event_type").notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().notNull(),
	leadId: uuid("lead_id"),
	errorMessage: text("error_message"),
}, (table) => [
	index("billing_ingest_events_received_at_idx").using("btree", table.receivedAt.asc().nullsLast().op("timestamptz_ops")),
	index("billing_ingest_events_type_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	unique("billing_ingest_events_external_event_id_unique").on(table.externalEventId),
]);

export const billingPayments = pgTable("billing_payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id"),
	subscriptionId: uuid("subscription_id"),
	externalPaymentId: text("external_payment_id").notNull(),
	amountCents: integer("amount_cents").notNull(),
	currency: text().notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }).notNull(),
	status: text().notNull(),
	rawPayload: jsonb("raw_payload"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("billing_payments_lead_idx").using("btree", table.leadId.asc().nullsLast().op("uuid_ops")),
	index("billing_payments_paid_at_idx").using("btree", table.paidAt.asc().nullsLast().op("timestamptz_ops")),
	index("billing_payments_sub_idx").using("btree", table.subscriptionId.asc().nullsLast().op("uuid_ops")),
	unique("billing_payments_external_payment_id_unique").on(table.externalPaymentId),
]);

export const billingSubscriptions = pgTable("billing_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	leadId: uuid("lead_id"),
	externalSubscriptionId: text("external_subscription_id").notNull(),
	planCode: text("plan_code").notNull(),
	planCurrency: text("plan_currency").notNull(),
	planAmountCents: integer("plan_amount_cents").notNull(),
	interval: text().notNull(),
	status: text().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	rawPayload: jsonb("raw_payload"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("billing_subscriptions_lead_idx").using("btree", table.leadId.asc().nullsLast().op("uuid_ops")),
	index("billing_subscriptions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("billing_subscriptions_external_subscription_id_unique").on(table.externalSubscriptionId),
]);

export const billingUnmatched = pgTable("billing_unmatched", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ingestEventId: uuid("ingest_event_id").notNull(),
	attemptedMatchKeys: jsonb("attempted_match_keys").notNull(),
	rawPayload: jsonb("raw_payload").notNull(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	resolvedByLeadId: uuid("resolved_by_lead_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const lifecycleExecutions = pgTable("lifecycle_executions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ruleId: uuid("rule_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	triggeredBy: text("triggered_by").notNull(),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: 'string' }).notNull(),
	executedAt: timestamp("executed_at", { withTimezone: true, mode: 'string' }),
	status: text().default('pending').notNull(),
	skipReason: text("skip_reason"),
	result: jsonb(),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("lifecycle_executions_lead_idx").using("btree", table.leadId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("lifecycle_executions_pending_due_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.scheduledFor.asc().nullsLast().op("text_ops")),
	uniqueIndex("lifecycle_executions_rule_lead_trigger_uniq").using("btree", table.ruleId.asc().nullsLast().op("uuid_ops"), table.leadId.asc().nullsLast().op("uuid_ops"), table.triggeredBy.asc().nullsLast().op("uuid_ops")),
]);
