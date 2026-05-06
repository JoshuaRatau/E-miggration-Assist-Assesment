import { Router, type IRouter } from "express";
import { db, caseMessagesTable, type CaseMessage } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serializeMessage(row: CaseMessage) {
  return {
    id: row.id,
    leadId: row.leadId,
    direction: row.direction,
    message: row.message,
    intent: row.intent,
    matchedKeyword: row.matchedKeyword,
    waMessageId: row.waMessageId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET /api/admin/leads/:id/messages
 *
 * Inbound message timeline for a single lead, newest first. Token gated
 * because the bodies contain raw user-typed text (PII). Mirrors the
 * `/engagements` endpoint structure for consistency.
 */
router.get("/admin/leads/:id/messages", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid lead id" });
  }

  const rows = await db
    .select()
    .from(caseMessagesTable)
    .where(eq(caseMessagesTable.leadId, id))
    .orderBy(desc(caseMessagesTable.createdAt));

  return res.json(rows.map(serializeMessage));
});

export default router;
