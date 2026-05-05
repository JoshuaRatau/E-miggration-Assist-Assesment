import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { db, caseMessagesTable, type CaseMessage } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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
  const expected = process.env["ADMIN_EMAIL_TOKEN"];
  if (!expected) {
    req.log.error(
      "ADMIN_EMAIL_TOKEN env var is not set; refusing admin messages request",
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
      "Rejected admin messages request — invalid or missing token",
    );
    res.status(401).json({ error: "Invalid admin token" });
    return false;
  }
  return true;
}

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
  if (!requireAdminToken(req, res)) return;

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
