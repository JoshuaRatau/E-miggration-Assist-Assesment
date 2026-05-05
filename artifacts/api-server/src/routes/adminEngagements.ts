import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  db,
  prelaunchLeadsTable,
  leadEngagementsTable,
  analyticsEventsTable,
  type LeadEngagement,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sendMessage } from "../lib/messaging";

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      "ADMIN_EMAIL_TOKEN env var is not set; refusing admin engagement request",
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
      "Rejected admin engagement request — invalid or missing token",
    );
    res.status(401).json({ error: "Invalid admin token" });
    return false;
  }
  return true;
}

function serializeEngagement(row: LeadEngagement) {
  return {
    id: row.id,
    leadId: row.leadId,
    channel: row.channel,
    type: row.type,
    status: row.status,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * POST /api/admin/leads/:id/send-update
 *
 * Send an ad-hoc update to a single lead. Channel is fixed to 'email' for
 * now; the messaging gateway in `lib/messaging.ts` routes to the right
 * provider, and the engagement row is created BEFORE the send is attempted
 * so an in-flight crash still leaves an auditable 'pending' record.
 *
 * Body: { message: string }
 *   * Trimmed; empty messages are rejected with 400.
 *   * The forbidden-phrase screen in `email.ts` runs server-side on the
 *     subject + body. A blocked phrase comes back as a 'failed' engagement
 *     with reason 'forbidden_phrase:<match>'.
 *
 * Return shape: the resulting engagement row (so the frontend can append
 * it to the history view immediately).
 */
router.post("/admin/leads/:id/send-update", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid lead id" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawMessage = body.message;
  if (typeof rawMessage !== "string") {
    return res.status(400).json({ error: "message must be a string" });
  }
  const message = rawMessage.trim();
  if (message.length === 0) {
    return res.status(400).json({ error: "message must not be empty" });
  }
  if (message.length > 5000) {
    return res
      .status(400)
      .json({ error: "message must be 5000 characters or fewer" });
  }

  const [lead] = await db
    .select({
      id: prelaunchLeadsTable.id,
      email: prelaunchLeadsTable.email,
      referenceNumber: prelaunchLeadsTable.referenceNumber,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

  if (!lead) {
    return res.status(404).json({ error: "Lead not found" });
  }

  // Insert the engagement row BEFORE the send. If the DB insert itself
  // fails we cannot proceed (no audit trail), so we 500. Once the row
  // exists, the send is allowed to fail without blocking the request.
  let engagement: LeadEngagement;
  try {
    const [row] = await db
      .insert(leadEngagementsTable)
      .values({
        leadId: lead.id,
        channel: "email",
        type: "manual",
        status: "pending",
        message,
      })
      .returning();
    if (!row) throw new Error("insert returned no rows");
    engagement = row;
  } catch (err) {
    req.log.error({ err }, "Failed to create manual engagement row");
    return res
      .status(500)
      .json({ error: "Failed to record engagement" });
  }

  // Attempt the send. `sendMessage` never throws — it returns either
  // { ok: true } or { ok: false, reason, pending? }. `pending: true` means
  // the failure is transient (provider not configured) and the row should
  // stay 'pending' for a future retry rather than be marked 'failed'.
  const result = await sendMessage({
    channel: "email",
    to: lead.email,
    message,
    subject: "Update on Your Assessment",
    referenceNumber: lead.referenceNumber,
  });

  let nextStatus: "sent" | "failed" | "pending" = "pending";
  if (result.ok) nextStatus = "sent";
  else if (result.pending) nextStatus = "pending";
  else nextStatus = "failed";

  if (nextStatus !== "pending") {
    try {
      const [updated] = await db
        .update(leadEngagementsTable)
        .set({ status: nextStatus })
        .where(eq(leadEngagementsTable.id, engagement.id))
        .returning();
      if (updated) engagement = updated;
    } catch (err) {
      req.log.warn(
        { err },
        "Failed to update engagement status after send attempt",
      );
    }
  }

  // Fire-and-forget analytics. NO PII — only the lead id, channel and the
  // resulting status are recorded. The message body is NEVER persisted to
  // analytics_events (only to the engagement row, which is admin-gated).
  db.insert(analyticsEventsTable)
    .values({
      eventName: "engagement.sent",
      leadId: lead.id,
      payload: {
        leadId: lead.id,
        engagementId: engagement.id,
        channel: "email",
        type: "manual",
        status: nextStatus,
      },
    })
    .catch((err) =>
      req.log.warn({ err }, "Failed to log engagement.sent analytics"),
    );

  return res.status(201).json({
    engagement: serializeEngagement(engagement),
    sent: result.ok,
    reason: result.ok ? null : result.reason,
  });
});

/**
 * GET /api/admin/leads/:id/engagements
 *
 * Returns the engagement history for a single lead, newest first. Token
 * gated so the message bodies (which may contain operator-typed PII) are
 * never exposed publicly.
 */
router.get("/admin/leads/:id/engagements", async (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid lead id" });
  }

  const rows = await db
    .select()
    .from(leadEngagementsTable)
    .where(eq(leadEngagementsTable.leadId, id))
    .orderBy(desc(leadEngagementsTable.createdAt));

  return res.json(rows.map(serializeEngagement));
});

export default router;
