import { db, lifecycleRulesTable } from "@workspace/db";
import { logger } from "./logger";

// Phase 6F-4a — seed the three starter rules (all disabled).
//
// Idempotent: rules are matched by `name`. If a row with the same
// name already exists we leave it alone — operators may have
// edited conditions/templates and re-seeding must never clobber
// their work. Same convention as templateBootstrap.

interface StarterRule {
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  delayMinutes: number;
}

const STARTER_RULES: StarterRule[] = [
  {
    name: "Welcome drip — 24h after assessment",
    description:
      "Sends the welcome email template 24 hours after a lead completes the assessment, but only if no one has reached out yet (lead_status still 'new').",
    triggerType: "lead_created",
    triggerConfig: {},
    conditions: {
      rules: [{ field: "leadStatus", op: "eq", value: "new" }],
    },
    actionType: "send_email_template",
    // templateId left null — operator picks one in 6F-4d UI before enabling.
    actionConfig: { templateId: null },
    delayMinutes: 24 * 60,
  },
  {
    name: "SLA breach — alert assigned rep",
    description:
      "When a lead's next-follow-up SLA passes without status advancement, email the assigned admin so the lead doesn't slip.",
    triggerType: "sla_breached",
    triggerConfig: { channel: "any" },
    conditions: {
      rules: [{ field: "assignedTo", op: "is_not_null", value: null }],
    },
    actionType: "notify_assignee_email",
    actionConfig: {
      subject: "SLA breach: lead needs attention",
      body: "A lead assigned to you has passed its next-follow-up SLA without status change. Please follow up.",
    },
    delayMinutes: 0,
  },
  {
    name: "Re-engagement — 14 days quiet",
    description:
      "Tags any lead in 'contacted' or 'qualified' that hasn't been contacted in 14 days for re-engagement triage.",
    triggerType: "time_since_event",
    triggerConfig: { field: "lastContactedAt", days: 14 },
    conditions: {
      rules: [
        { field: "leadStatus", op: "in", value: ["contacted", "qualified"] },
      ],
    },
    actionType: "set_tag",
    actionConfig: { tag: "needs_reengagement" },
    delayMinutes: 0,
  },
];

export interface LifecycleBootstrapResult {
  ok: boolean;
  inserted: number;
  skipped: number;
  error?: string;
}

export async function bootstrapLifecycleRules(): Promise<LifecycleBootstrapResult> {
  let inserted = 0;
  let skipped = 0;
  try {
    for (const rule of STARTER_RULES) {
      // Atomic insert-or-skip: relies on the UNIQUE index on
      // lifecycle_rules.name. Concurrent boots cannot double-seed.
      // `.returning()` on `onConflictDoNothing` yields [] when the
      // row already existed, so we count via array length rather
      // than a separate SELECT.
      const result = await db
        .insert(lifecycleRulesTable)
        .values({
          name: rule.name,
          description: rule.description,
          enabled: false,
          triggerType: rule.triggerType,
          triggerConfig: rule.triggerConfig,
          conditions: rule.conditions,
          actionType: rule.actionType,
          actionConfig: rule.actionConfig,
          delayMinutes: rule.delayMinutes,
        })
        .onConflictDoNothing({ target: lifecycleRulesTable.name })
        .returning({ id: lifecycleRulesTable.id });
      if (result.length > 0) inserted++;
      else skipped++;
    }
    return { ok: true, inserted, skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "lifecycle bootstrap failed");
    return { ok: false, inserted, skipped, error: message };
  }
}
