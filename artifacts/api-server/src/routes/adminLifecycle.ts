import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  lifecycleRulesTable,
  lifecycleExecutionsTable,
  type LifecycleRule,
  type LifecycleExecution,
} from "@workspace/db";
import { requireAdminAuth } from "../lib/adminAuth";

// Phase 6F-4a — Lifecycle Automations (READ-ONLY scaffold).
//
// Three endpoints, all admin-gated:
//   GET /api/admin/lifecycle/rules                — list rules
//   GET /api/admin/lifecycle/rules/:id            — single rule + recent executions
//   GET /api/admin/lifecycle/rules/:id/executions — paginated history
//
// Mutations (create/update/toggle) and the worker arrive in 6F-4b
// onwards. Keeping this surface read-only in 6F-4a ensures shipping
// the schema + UI tab cannot accidentally fire any side-effects.

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serializeRule(r: LifecycleRule) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    triggerType: r.triggerType,
    triggerConfig: r.triggerConfig ?? {},
    conditions: r.conditions ?? {},
    actionType: r.actionType,
    actionConfig: r.actionConfig ?? {},
    delayMinutes: r.delayMinutes,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
  };
}

function serializeExecution(e: LifecycleExecution) {
  return {
    id: e.id,
    ruleId: e.ruleId,
    leadId: e.leadId,
    triggeredBy: e.triggeredBy,
    scheduledFor: e.scheduledFor.toISOString(),
    executedAt: e.executedAt ? e.executedAt.toISOString() : null,
    status: e.status,
    skipReason: e.skipReason,
    result: e.result,
    error: e.error,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/admin/lifecycle/rules", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const includeArchived = req.query["includeArchived"] === "true";
  const rows = await db
    .select()
    .from(lifecycleRulesTable)
    .where(
      includeArchived ? undefined : isNull(lifecycleRulesTable.archivedAt),
    )
    .orderBy(desc(lifecycleRulesTable.createdAt));
  res.json({ rules: rows.map(serializeRule) });
});

router.get("/admin/lifecycle/rules/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const ruleRows = await db
    .select()
    .from(lifecycleRulesTable)
    .where(eq(lifecycleRulesTable.id, id))
    .limit(1);
  const rule = ruleRows[0];
  if (!rule) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const recent = await db
    .select()
    .from(lifecycleExecutionsTable)
    .where(eq(lifecycleExecutionsTable.ruleId, id))
    .orderBy(desc(lifecycleExecutionsTable.createdAt))
    .limit(10);
  res.json({
    rule: serializeRule(rule),
    recentExecutions: recent.map(serializeExecution),
  });
});

router.get("/admin/lifecycle/rules/:id/executions", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const status =
    typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  // Fail-closed on unknown status values rather than silently ignoring
  // them — surprising client behaviour was flagged in code review.
  if (
    status !== undefined &&
    !["pending", "completed", "skipped", "failed"].includes(status)
  ) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }
  const limit = Math.min(
    Math.max(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 1),
    200,
  );
  const conditions = [eq(lifecycleExecutionsTable.ruleId, id)];
  if (status) {
    conditions.push(eq(lifecycleExecutionsTable.status, status));
  }
  const rows = await db
    .select()
    .from(lifecycleExecutionsTable)
    .where(and(...conditions))
    .orderBy(desc(lifecycleExecutionsTable.createdAt))
    .limit(limit);
  res.json({ executions: rows.map(serializeExecution) });
});

export default router;
