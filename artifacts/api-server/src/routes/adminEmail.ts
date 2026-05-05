import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { db, prelaunchLeadsTable, analyticsEventsTable } from "@workspace/db";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { sendUpdateEmail } from "../lib/email";

const router: IRouter = Router();

const RATE_WINDOW_MS = 5 * 60 * 1000;
const lastSentByIp = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of lastSentByIp.entries()) {
    if (now - ts > RATE_WINDOW_MS) lastSentByIp.delete(ip);
  }
}, 60 * 1000).unref();

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

router.post("/admin/email/update", async (req, res) => {
  // Auth gate: a server-only env var must be set, and the request must
  // present a matching x-admin-token header. Fail-closed if env var is unset.
  const expected = process.env.ADMIN_EMAIL_TOKEN;
  if (!expected) {
    req.log.error(
      "ADMIN_EMAIL_TOKEN env var is not set; refusing admin email request",
    );
    return res.status(503).json({
      error: "Admin email is not configured",
    });
  }
  const provided =
    typeof req.header("x-admin-token") === "string"
      ? (req.header("x-admin-token") as string)
      : "";
  if (!provided || !tokensMatch(provided, expected)) {
    req.log.warn(
      { ip: req.ip },
      "Rejected admin email request — invalid or missing token",
    );
    return res.status(401).json({ error: "Invalid admin token" });
  }

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
