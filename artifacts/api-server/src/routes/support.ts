import { type IRouter, Router } from "express";
import { z } from "zod";
import { db, supportRequestsTable } from "@workspace/db";
import { createRateBucket } from "../lib/rateLimit";
import { sendInternalNotificationEmail } from "../lib/email";

// Inbox that receives support-widget queries. Configurable via env so the
// destination can change without a code edit; defaults to the team inbox.
const SUPPORT_NOTIFY_EMAIL =
  process.env.SUPPORT_NOTIFY_EMAIL?.trim() || "info@emigration-assist.com";

const CATEGORY_LABELS: Record<string, string> = {
  support_query: "Support query",
  technical_issue: "Technical issue",
  payment_account: "Payment / account",
  general_question: "General question",
};

const router: IRouter = Router();

// Pre-launch volume on a single VM — a generous per-IP window is plenty.
const supportRateLimitByIp = createRateBucket({
  windowMs: 60 * 60 * 1000,
  max: 20,
});

const CATEGORY = [
  "support_query",
  "technical_issue",
  "payment_account",
  "general_question",
] as const;

const Body = z.object({
  category: z.enum(CATEGORY),
  message: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  pagePath: z.string().trim().max(300).optional().nullable(),
  website: z.string().optional(), // honeypot
});

router.post("/support", async (req, res) => {
  // Honeypot — bots that fill the hidden field get a synthetic success.
  const honey = (req.body as { website?: unknown } | null | undefined)?.website;
  if (typeof honey === "string" && honey.trim().length > 0) {
    return res.status(201).json({ ok: true });
  }

  const ipDec = supportRateLimitByIp.hit(req.ip ?? "unknown");
  if (!ipDec.ok) {
    res.setHeader("Retry-After", String(ipDec.retryAfterSec));
    return res
      .status(429)
      .json({ error: "Too many requests. Please try again later." });
  }

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const data = parsed.data;
  const email = data.email && data.email.length > 0 ? data.email : null;

  try {
    const [inserted] = await db
      .insert(supportRequestsTable)
      .values({
        category: data.category,
        message: data.message,
        name: data.name ?? null,
        email,
        pagePath: data.pagePath ?? null,
      })
      .returning({ id: supportRequestsTable.id });

    if (!inserted) {
      return res.status(500).json({ error: "Failed to record request" });
    }

    req.log.info(
      { supportRequestId: inserted.id, category: data.category },
      "Support request recorded",
    );

    // Notify the team inbox. Fire-and-forget: a delivery failure must never
    // turn a successfully-recorded request into a 500 for the user.
    const categoryLabel = CATEGORY_LABELS[data.category] ?? data.category;
    const body = [
      "New support request from the E-Migration Assist widget.",
      "",
      `Category: ${categoryLabel}`,
      `Name: ${data.name?.trim() || "(not provided)"}`,
      `Email: ${email ?? "(not provided)"}`,
      `Page: ${data.pagePath?.trim() || "(unknown)"}`,
      `Reference: ${inserted.id}`,
      "",
      "Message:",
      data.message,
    ].join("\n");

    void sendInternalNotificationEmail({
      to: SUPPORT_NOTIFY_EMAIL,
      subject: `[Support] ${categoryLabel}`,
      text: body,
      ...(email ? { replyTo: email } : {}),
    })
      .then((result) => {
        if (!result.ok) {
          req.log.error(
            { supportRequestId: inserted.id, reason: result.reason },
            "Support notification email failed to send",
          );
        }
      })
      .catch((err) => {
        req.log.error(
          { err, supportRequestId: inserted.id },
          "Support notification email threw",
        );
      });

    return res.status(201).json({ ok: true, id: inserted.id });
  } catch (err) {
    req.log.error({ err }, "Failed to insert support request");
    return res.status(500).json({ error: "Failed to record request" });
  }
});

export const supportRouter = router;
export default router;
