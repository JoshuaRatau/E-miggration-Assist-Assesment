import { Router, type IRouter } from "express";
import { db, prelaunchLeadsTable, analyticsEventsTable } from "@workspace/db";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { sendUpdateEmail } from "../lib/email";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

const RATE_WINDOW_MS = 5 * 60 * 1000;
const lastSentByIp = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of lastSentByIp.entries()) {
    if (now - ts > RATE_WINDOW_MS) lastSentByIp.delete(ip);
  }
}, 60 * 1000).unref();

router.post("/admin/email/update", async (req, res) => {
  // Auth gate: cookie-session first, falls back to legacy x-admin-token.
  if (!(await requireAdminToken(req, res))) return;

  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const last = lastSentByIp.get(ip);
  if (last && now - last < RATE_WINDOW_MS) {
    const retry = Math.ceil((RATE_WINDOW_MS - (now - last)) / 1000);
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({
      error: "Rate limited",
      retryAfterSeconds: retry,
    });
  }
  lastSentByIp.set(ip, now);

  const recipients = await db
    .select({
      id: prelaunchLeadsTable.id,
      referenceNumber: prelaunchLeadsTable.referenceNumber,
      email: prelaunchLeadsTable.email,
    })
    .from(prelaunchLeadsTable)
    .where(
      and(
        eq(prelaunchLeadsTable.consentAccepted, true),
        isNotNull(prelaunchLeadsTable.email),
        ne(prelaunchLeadsTable.email, ""),
      ),
    );

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const r of recipients) {
    if (!r.email) continue;
    attempted += 1;
    const result = await sendUpdateEmail({
      to: r.email,
      referenceNumber: r.referenceNumber,
    });
    if (result.ok) succeeded += 1;
    else failed += 1;

    try {
      await db.insert(analyticsEventsTable).values({
        eventName: "email_sent_update",
        leadId: r.id,
        referenceNumber: r.referenceNumber,
        payload: result.ok
          ? { success: true, messageId: result.id }
          : { success: false, reason: result.reason },
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to log email_sent_update analytics");
    }
  }

  req.log.info(
    { attempted, succeeded, failed },
    "Admin update email batch completed",
  );

  return res.json({
    eligibleRecipients: recipients.length,
    attempted,
    succeeded,
    failed,
  });
});

export default router;
