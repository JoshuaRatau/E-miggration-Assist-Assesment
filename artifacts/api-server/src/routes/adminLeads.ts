import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { db, prelaunchLeadsTable, analyticsEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  LEAD_STATUS_VALUES,
  LEAD_PRIORITY_VALUES,
} from "../lib/classification";

const router: IRouter = Router();

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function requireAdminToken(
  req: import("express").Request,
  res: import("express").Response,
): boolean {
  const expected = process.env.ADMIN_EMAIL_TOKEN;
  if (!expected) {
    req.log.error(
      "ADMIN_EMAIL_TOKEN env var is not set; refusing admin lead update",
    );
    res.status(503).json({ error: "Admin endpoints are not configured" });
    return false;
  }
  const provided =
    typeof req.header("x-admin-token") === "string"
      ? (req.header("x-admin-token") as string)
      : "";
  if (!provided || !tokensMatch(provided, expected)) {
    req.log.warn(
      { ip: req.ip },
      "Rejected admin lead update — invalid or missing token",
    );
    res.status(401).json({ error: "Invalid admin token" });
    return false;
  }
  return true;
}

function serializeLead(row: typeof prelaunchLeadsTable.$inferSelect) {
  return {
    ...row,
    visaExpiryDate: row.visaExpiryDate ?? null,
    exitDate: row.exitDate ?? null,
    consentTimestamp: row.consentTimestamp
      ? row.consentTimestamp.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasWhatsapp: typeof row.whatsapp === "string" && row.whatsapp.length > 0,
  };
}

/**
 * PATCH /api/admin/leads/:id
 *
 * Admin-only inline CRM update endpoint.  Mutates ONLY the operator-managed
 * fields: status, priority, notes.  Every other column is preserved.
 *
 * Auth: x-admin-token header must equal ADMIN_EMAIL_TOKEN (server-only env).
 *       The endpoint fails closed (503) if the env var is unset.
 *
 * Body: any subset of { status, priority, notes } — at least one required.
 *   - status   ∈ new | reviewing | contacted | converted | closed
 *   - priority ∈ high | medium | low
 *   - notes    ∈ string | null
 *
 * Analytics: emits a server-side `admin.lead_updated` event with NO PII —
 * only `{ leadId, fieldsUpdated: [...] }`.
 */
router.patch("/admin/leads/:id", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const { id } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const updates: Partial<typeof prelaunchLeadsTable.$inferInsert> = {};
  const fieldsUpdated: string[] = [];

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const v = body.status;
    if (typeof v !== "string" || !LEAD_STATUS_VALUES.includes(v as never)) {
      return res.status(400).json({
        error: `status must be one of: ${LEAD_STATUS_VALUES.join(", ")}`,
      });
    }
    updates.leadStatus = v;
    fieldsUpdated.push("status");
  }

  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    const v = body.priority;
    if (typeof v !== "string" || !LEAD_PRIORITY_VALUES.includes(v as never)) {
      return res.status(400).json({
        error: `priority must be one of: ${LEAD_PRIORITY_VALUES.join(", ")}`,
      });
    }
    updates.leadPriority = v;
    fieldsUpdated.push("priority");
  }

  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    const v = body.notes;
    if (v !== null && typeof v !== "string") {
      return res
        .status(400)
        .json({ error: "notes must be a string or null" });
    }
    updates.adminNotes = v;
    fieldsUpdated.push("notes");
  }

  if (fieldsUpdated.length === 0) {
    return res.status(400).json({
      error: "Body must include at least one of: status, priority, notes",
    });
  }

  updates.updatedAt = new Date();

  const [updated] = await db
    .update(prelaunchLeadsTable)
    .set(updates)
    .where(eq(prelaunchLeadsTable.id, id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "Lead not found" });
  }

  // Fire-and-forget analytics. Telemetry minimisation per spec: ONLY the
  // lead id (FK column + payload field) and the names of the updated fields
  // are persisted. The denormalised `reference_number` column is intentionally
  // left NULL on this row so no extra identifier is recorded.
  db.insert(analyticsEventsTable)
    .values({
      eventName: "admin.lead_updated",
      leadId: updated.id,
      payload: { leadId: updated.id, fieldsUpdated },
    })
    .catch((err) =>
      req.log.warn({ err }, "Failed to log admin.lead_updated event"),
    );

  return res.json(serializeLead(updated));
});

export default router;
