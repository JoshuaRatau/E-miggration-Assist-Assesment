import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  leadEngagementsTable,
  analyticsEventsTable,
  type LeadEngagement,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sendMessage, type MessagingChannel } from "../lib/messaging";
import { requireAdminToken } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";

const ALLOWED_CHANNELS: readonly MessagingChannel[] = ["email", "whatsapp"];

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!(await requireAdminToken(req, res))) return;

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

  // Channel: optional, defaults to 'email' for back-compat with existing
  // callers. We never trust the client — only the small known-good set
  // declared at module top is accepted.
  const rawChannel =
    typeof body.channel === "string" ? body.channel.toLowerCase() : "email";
  if (!ALLOWED_CHANNELS.includes(rawChannel as MessagingChannel)) {
    return res
      .status(400)
      .json({ error: "channel must be 'email' or 'whatsapp'" });
  }
  const channel = rawChannel as MessagingChannel;

  const [lead] = await db
    .select({
      id: prelaunchLeadsTable.id,
      email: prelaunchLeadsTable.email,
      whatsapp: prelaunchLeadsTable.whatsapp,
      referenceNumber: prelaunchLeadsTable.referenceNumber,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);

  if (!lead) {
    return res.status(404).json({ error: "Lead not found" });
  }

  // Resolve recipient up-front: if the lead has no contact for the chosen
  // channel, refuse with 400 BEFORE inserting an engagement row. There is
  // no point persisting a row that can never be delivered.
  const recipient = channel === "whatsapp" ? lead.whatsapp : lead.email;
  if (!recipient) {
    return res.status(400).json({
      error:
        channel === "whatsapp"
          ? "Lead has no WhatsApp number on file"
          : "Lead has no email address on file",
    });
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
        channel,
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
    channel,
    to: recipient,
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
        channel,
        type: "manual",
        status: nextStatus,
      },
    })
    .catch((err) =>
      req.log.warn({ err }, "Failed to log engagement.sent analytics"),
    );

  // Audit trail (fire-and-forget). Records the attempt regardless of
  // delivery outcome so a forensic review can correlate "we tried to
  // send X to lead Y at T" with provider logs. We never persist the
  // raw message body in the audit row — that's already in the
  // engagement row, which is admin-gated.
  void writeAudit({
    req,
    action: "outbound_message_attempted",
    leadId: lead.id,
    after: {
      engagementId: engagement.id,
      channel,
      type: "manual",
      status: nextStatus,
    },
  });

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
  if (!(await requireAdminToken(req, res))) return;

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
