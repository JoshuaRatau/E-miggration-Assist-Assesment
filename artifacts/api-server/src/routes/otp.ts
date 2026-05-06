import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, leadOtpsTable } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  generateOtpCode,
  hashOtpCode,
  safeEqualHex,
} from "../lib/otp";
import { sendMessage } from "../lib/messaging";
import { sendCustomEmail } from "../lib/email";
import { normalizeWhatsapp } from "../lib/whatsapp";

const router: IRouter = Router();

const RequestBody = z.object({
  channel: z.enum(["email", "whatsapp"]),
  email: z.string().email(),
  whatsapp: z.string().optional().nullable(),
});

const VerifyBody = z.object({
  otpId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

const isDev = process.env["NODE_ENV"] !== "production";

function composeOtpMessage(code: string): string {
  return [
    `Your E-Migration Assist verification code is: ${code}`,
    "",
    "This code expires in 10 minutes. If you did not request it, you can ignore this message.",
  ].join("\n");
}

/**
 * POST /api/otp/request
 *
 * Generates a 6-digit code, hashes + stores it (10-min TTL), and dispatches
 * via the requested channel. WhatsApp falls back to email when the WA send
 * cannot be completed (no number on file, gateway not configured, transient
 * provider error). In non-production the code is also returned in the
 * response body to keep dev/QA flows unblocked when no real provider is
 * connected.
 */
router.post("/otp/request", async (req, res) => {
  const parsed = RequestBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const { channel, email } = parsed.data;
  const normalizedWhatsapp = parsed.data.whatsapp
    ? normalizeWhatsapp(parsed.data.whatsapp)
    : null;

  if (channel === "whatsapp" && !normalizedWhatsapp) {
    return res
      .status(400)
      .json({ error: "A valid WhatsApp number is required for that channel" });
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [row] = await db
    .insert(leadOtpsTable)
    .values({
      channel,
      email,
      whatsapp: normalizedWhatsapp,
      codeHash,
      expiresAt,
    })
    .returning();

  if (!row) {
    return res.status(500).json({ error: "Failed to create verification" });
  }

  // Dispatch — fire-and-forget would be wrong here because the user is
  // waiting on the screen. We DO await, but we never expose provider errors
  // to the client (only "delivered_via" so the UI can word the prompt).
  let deliveredVia: "email" | "whatsapp" = channel;
  let deliveryNote: string | null = null;

  const message = composeOtpMessage(code);

  if (channel === "whatsapp") {
    const wa = await sendMessage({
      channel: "whatsapp",
      to: normalizedWhatsapp,
      message,
    });
    if (!wa.ok) {
      req.log.info(
        { reason: wa.reason },
        "OTP WhatsApp delivery unavailable; falling back to email",
      );
      const em = await sendCustomEmail({
        to: email,
        subject: "Your verification code",
        text: message,
      });
      if (em.ok) {
        deliveredVia = "email";
        deliveryNote = "WhatsApp delivery was unavailable, code sent by email.";
      } else {
        // Both channels failed. In production this is a hard error; in dev
        // we let the flow proceed because the dev code is in the response.
        if (!isDev) {
          return res
            .status(502)
            .json({ error: "Could not deliver verification code" });
        }
        deliveryNote = "No delivery channel available — check server logs.";
      }
    }
  } else {
    const em = await sendCustomEmail({
      to: email,
      subject: "Your verification code",
      text: message,
    });
    if (!em.ok) {
      if (!isDev) {
        return res
          .status(502)
          .json({ error: "Could not deliver verification code" });
      }
      deliveryNote = "Email delivery unavailable — check server logs.";
    }
  }

  // Always log on the server in dev so QA can read the code from the
  // workflow log even when the response is consumed by an automated test.
  if (isDev) {
    req.log.info(
      { otpId: row.id, code, deliveredVia },
      "OTP issued (dev only — code echoed)",
    );
  }

  return res.status(201).json({
    otpId: row.id,
    deliveredVia,
    deliveryNote,
    expiresAt: row.expiresAt.toISOString(),
    ...(isDev ? { devCode: code } : {}),
  });
});

/**
 * POST /api/otp/verify
 *
 * Constant-time hash compare. Increments attempts on every call, fails
 * permanently after OTP_MAX_ATTEMPTS. On success sets consumed_at — the
 * row becomes a single-use proof referenced by `verifiedOtpId` on lead
 * creation (server enforces 30-min validity window there).
 */
router.post("/otp/verify", async (req, res) => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const { otpId, code } = parsed.data;

  const rows = await db
    .select()
    .from(leadOtpsTable)
    .where(eq(leadOtpsTable.id, otpId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: "Verification not found" });
  }

  if (row.consumedAt) {
    // Idempotency: returning success for an already-consumed row would let
    // a leaked otpId be reused by a third party. Treat as a hard failure.
    return res.status(409).json({ error: "Verification already used" });
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "Verification expired" });
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many attempts" });
  }

  const provided = hashOtpCode(code);
  const matches = safeEqualHex(provided, row.codeHash);

  if (!matches) {
    // Atomic increment + cap predicate so concurrent guesses cannot race
    // past the cap (lost-update). The expression `attempts + 1` runs in
    // SQL, and the WHERE clause refuses to bump past OTP_MAX_ATTEMPTS;
    // when no row updates we know the cap was hit (or row was consumed).
    const [updated] = await db
      .update(leadOtpsTable)
      .set({ attempts: sql`${leadOtpsTable.attempts} + 1` })
      .where(
        and(
          eq(leadOtpsTable.id, otpId),
          isNull(leadOtpsTable.consumedAt),
          lt(leadOtpsTable.attempts, OTP_MAX_ATTEMPTS),
        ),
      )
      .returning({ attempts: leadOtpsTable.attempts });
    if (!updated) {
      return res.status(429).json({ error: "Too many attempts" });
    }
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);
    return res.status(400).json({ error: "Incorrect code", remaining });
  }

  const [consumed] = await db
    .update(leadOtpsTable)
    .set({ consumedAt: new Date() })
    .where(
      and(eq(leadOtpsTable.id, otpId), isNull(leadOtpsTable.consumedAt)),
    )
    .returning({ id: leadOtpsTable.id, channel: leadOtpsTable.channel });

  if (!consumed) {
    // A concurrent verify won; treat the second one as already-used.
    return res.status(409).json({ error: "Verification already used" });
  }

  return res.json({
    verified: true,
    otpId: consumed.id,
    channel: consumed.channel,
  });
});

export default router;
