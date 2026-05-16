-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "lifecycle_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb,
	"conditions" jsonb,
	"action_type" text NOT NULL,
	"action_config" jsonb,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"lead_id" uuid,
	"reference_number" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"wa_message_id" text,
	"message" text NOT NULL,
	"intent" text,
	"matched_keyword" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "lead_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"case_id" uuid,
	"actor_token_hash" text,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"rubric" text,
	"payload" jsonb,
	"source" text DEFAULT 'system' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"email" text,
	"whatsapp" text,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prelaunch_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"file_size" integer,
	"upload_status" text DEFAULT 'UPLOADED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prelaunch_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_number" text NOT NULL,
	"full_name" text,
	"email" text,
	"whatsapp" text,
	"nationality" text,
	"country_of_residence" text,
	"currently_in_south_africa" boolean,
	"passport_status" text,
	"visa_history" text,
	"immigration_situation" text,
	"visa_expiry_date" date,
	"exit_date" date,
	"border_document_issued" text,
	"overstay_reason" text,
	"has_supporting_documents" text,
	"previous_overstay" text,
	"internal_classification" text,
	"lead_score" integer,
	"lead_category" text,
	"lead_priority" text DEFAULT 'medium',
	"lead_status" text DEFAULT 'new' NOT NULL,
	"admin_notes" text,
	"preferred_contact_method" text,
	"consent_accepted" boolean DEFAULT false NOT NULL,
	"consent_timestamp" timestamp with time zone,
	"lead_type" text DEFAULT 'individual' NOT NULL,
	"inquiry_type" text,
	"source" text DEFAULT 'web_form',
	"source_campaign" text,
	"assigned_to" uuid,
	"last_contacted_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"tags" text[],
	"organization_name" text,
	"organization_type" text,
	"representative_name" text,
	"representative_email" text,
	"representative_phone" text,
	"intended_tier" text,
	"lead_score_breakdown" jsonb,
	"lead_score_computed_at" timestamp with time zone,
	"lead_score_rubric" text,
	"representative_role" text,
	"representative_relationship" text,
	"website" text,
	"firm_size" text,
	"operating_regions" text[],
	"service_focus" text,
	"estimated_client_volume" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prelaunch_leads_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "lead_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"reference_number" text NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_cases_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "admin_password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_superadmin" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "import_job_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"parsed" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"errors" jsonb,
	"resolved_lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid,
	"source_filename" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"lead_type" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"column_mapping" jsonb,
	"dedupe_strategy" text,
	"error_summary" jsonb,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_valid" integer DEFAULT 0 NOT NULL,
	"rows_invalid" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_skipped_duplicate" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"engagement_id" uuid,
	"channel_used" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"template_subject" text,
	"template_body" text,
	"whatsapp_template_sid" text,
	"audience_filter" jsonb,
	"audience_snapshot_count" integer DEFAULT 0 NOT NULL,
	"recipients_total" integer DEFAULT 0 NOT NULL,
	"recipients_sent" integer DEFAULT 0 NOT NULL,
	"recipients_failed" integer DEFAULT 0 NOT NULL,
	"recipients_skipped" integer DEFAULT 0 NOT NULL,
	"recipients_unsubscribed" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_type" text NOT NULL,
	"contact" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"unsubscribed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comm_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_ingest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"lead_id" uuid,
	"error_message" text,
	CONSTRAINT "billing_ingest_events_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
CREATE TABLE "billing_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"subscription_id" uuid,
	"external_payment_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_external_payment_id_unique" UNIQUE("external_payment_id")
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"external_subscription_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"plan_currency" text NOT NULL,
	"plan_amount_cents" integer NOT NULL,
	"interval" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_external_subscription_id_unique" UNIQUE("external_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "billing_unmatched" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_event_id" uuid NOT NULL,
	"attempted_match_keys" jsonb NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"triggered_by" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_rules_name_uniq" ON "lifecycle_rules" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "lead_events_lead_occurred_idx" ON "lead_events" USING btree ("lead_id" timestamptz_ops,"occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_lead_uniq" ON "campaign_recipients" USING btree ("campaign_id" uuid_ops,"lead_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "unsubscribes_type_contact_uniq" ON "unsubscribes" USING btree ("contact_type" text_ops,"contact" text_ops);--> statement-breakpoint
CREATE INDEX "billing_ingest_events_received_at_idx" ON "billing_ingest_events" USING btree ("received_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "billing_ingest_events_type_idx" ON "billing_ingest_events" USING btree ("event_type" text_ops);--> statement-breakpoint
CREATE INDEX "billing_payments_lead_idx" ON "billing_payments" USING btree ("lead_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "billing_payments_paid_at_idx" ON "billing_payments" USING btree ("paid_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "billing_payments_sub_idx" ON "billing_payments" USING btree ("subscription_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "billing_subscriptions_lead_idx" ON "billing_subscriptions" USING btree ("lead_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "billing_subscriptions_status_idx" ON "billing_subscriptions" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "lifecycle_executions_lead_idx" ON "lifecycle_executions" USING btree ("lead_id" timestamptz_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "lifecycle_executions_pending_due_idx" ON "lifecycle_executions" USING btree ("status" text_ops,"scheduled_for" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_executions_rule_lead_trigger_uniq" ON "lifecycle_executions" USING btree ("rule_id" uuid_ops,"lead_id" uuid_ops,"triggered_by" uuid_ops);
*/