import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Phase 6F-4 — Lifecycle Automations.
//
// Two narrow tables driving "if this lead-event happens, then do that"
// rules. The schema is intentionally declarative and storage-only here —
// 6F-4a ships this surface read-only (admin UI lists rules and execution
// history, no worker fires anything yet). The event-driven evaluator
// lands in 6F-4b, the tick worker in 6F-4c, and the rule editor UI in
// 6F-4d. Splitting it this way keeps each ship small and reviewable.
//
// Design choices:
//   * Plain text for trigger_type / action_type / status (same convention
//     as lead_status, campaign.status). Adding a new trigger doesn't
//     require a migration dance.
//   * conditions reuses the audienceQuery whitelist shape (single-level
//     AND, [{field, op, value}]) — no new query DSL to harden.
//   * Idempotency lives at the executions layer via a UNIQUE constraint
//     on (rule_id, lead_id, triggered_by). The same event firing twice
//     for the same lead+rule is a no-op insert (handled at the API).
//   * delay_minutes lives on the rule, not the action — keeps the
//     worker model trivially simple (one scheduled timestamp per
//     execution row).

export const lifecycleRulesTable = pgTable(
  "lifecycle_rules",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),

  // Always opt-in. New rules start disabled and the bootstrap-seeded
  // starter rules are also disabled so nothing fires until an operator
  // explicitly turns them on.
  enabled: boolean("enabled").notNull().default(false),

  //   trigger_type ∈ lead_created | status_changed | sla_breached |
  //                  time_since_event | tier_set
  // The evaluator routes off this column. New trigger types can be
  // added in code without a schema migration.
  triggerType: text("trigger_type").notNull(),

  // Per-trigger params. Examples:
  //   status_changed:    {fromStatus?: string, toStatus: string}
  //   sla_breached:      {channel: "email"|"whatsapp"|"phone"|"any"}
  //   time_since_event:  {field: "lastContactedAt", days: 14}
  //   tier_set:          {tier?: string}  // omit to fire on any tier set
  triggerConfig: jsonb("trigger_config"),

  // AND-joined whitelist conditions over lead fields.
  // Shape: {rules: [{field: string, op: string, value: unknown}]}
  // The field whitelist mirrors lib/audienceQuery.ts. An empty/missing
  // conditions object means "fire for every lead matching the trigger".
  conditions: jsonb("conditions"),

  //   action_type ∈ send_email_template | send_wa_template |
  //                 notify_assignee_email | set_tag | advance_status
  actionType: text("action_type").notNull(),

  // Per-action params. Examples:
  //   send_email_template:   {templateId: uuid}
  //   send_wa_template:      {templateId: uuid}
  //   notify_assignee_email: {subject: string, body: string}
  //   set_tag:               {tag: string}
  //   advance_status:        {targetStatus: string}
  actionConfig: jsonb("action_config"),

  // How long to wait between trigger firing and action executing.
  // 0 = immediate. The evaluator stamps scheduled_for = now() + delay
  // and the worker only picks it up once that time arrives.
  delayMinutes: integer("delay_minutes").notNull().default(0),

  // Authoring metadata. Soft-ref to admin_users.id (no FK), same
  // convention as templates / campaigns.
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    // Bootstrap idempotency: starter rules are matched by name. A unique
    // index makes concurrent boots race-safe (insert falls back to
    // onConflictDoNothing) and also gives the editor UI in 6F-4d a
    // cheap "name already taken" check.
    uniqName: uniqueIndex("lifecycle_rules_name_uniq").on(t.name),
  }),
);

export const lifecycleExecutionsTable = pgTable(
  "lifecycle_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id").notNull(),
    leadId: uuid("lead_id").notNull(),

    // Free-text label for the event that fired this execution
    // (e.g. "lead_event:assessment_completed:abc123" or
    // "tick:sla_breach"). Used by the UNIQUE constraint below to
    // make the same trigger firing twice for the same lead+rule a
    // no-op rather than a double-send.
    triggeredBy: text("triggered_by").notNull(),

    // When the action should fire (now() + rule.delayMinutes at insert).
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),

    //   status ∈ pending | completed | skipped | failed
    // skipped is a first-class state — if the lead unsubscribed
    // between schedule and execute, settle as skipped (not failed)
    // so reports stay readable.
    status: text("status").notNull().default("pending"),
    skipReason: text("skip_reason"),

    // {messageId?, auditId?, ...} — small JSON breadcrumb so the
    // execution row links back into engagements / audit trail.
    result: jsonb("result"),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Idempotency: same rule firing twice for the same lead via the
    // same trigger event is a programmer error (or a duplicate event
    // delivery). The insert path treats unique-violation as success.
    uniqExecution: uniqueIndex("lifecycle_executions_rule_lead_trigger_uniq").on(
      t.ruleId,
      t.leadId,
      t.triggeredBy,
    ),
    // Worker hot-path: scan for due-pending executions ordered by
    // scheduledFor.
    pendingByDue: index("lifecycle_executions_pending_due_idx").on(
      t.status,
      t.scheduledFor,
    ),
    // Per-lead history for the lead detail timeline.
    byLead: index("lifecycle_executions_lead_idx").on(
      t.leadId,
      t.createdAt,
    ),
  }),
);

export type LifecycleRule = typeof lifecycleRulesTable.$inferSelect;
export type InsertLifecycleRule = typeof lifecycleRulesTable.$inferInsert;
export type LifecycleExecution = typeof lifecycleExecutionsTable.$inferSelect;
export type InsertLifecycleExecution =
  typeof lifecycleExecutionsTable.$inferInsert;
