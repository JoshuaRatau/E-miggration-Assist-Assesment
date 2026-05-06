import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  adminUsersTable,
  adminPasswordResetsTable,
} from "@workspace/db/schema";
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
} from "../lib/adminPassword";
import {
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  loadSessionUser,
  tokenHash,
} from "../lib/adminSession";
import { sendCustomEmail } from "../lib/email";

const router: IRouter = Router();

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/admin/auth/login", async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const email = parsed.data.email.toLowerCase().trim();

  const userRows = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, email))
    .limit(1);
  const user = userRows[0];

  // Generic message for both "no such email" and "wrong password" so the
  // endpoint can't be used as an account-existence oracle.
  const GENERIC_FAIL = "Invalid email or password";

  if (!user || !user.isActive) {
    // Constant-time-ish: still hash a dummy password so the timing of
    // a wrong-email vs wrong-password response is closer.
    await verifyPassword(parsed.data.password, "$2b$12$invalidinvalidinvalidu");
    return res.status(401).json({ error: GENERIC_FAIL });
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    req.log.warn({ email }, "admin login failed");
    return res.status(401).json({ error: GENERIC_FAIL });
  }

  const session = await createSession(user.id);
  setSessionCookie(res, session.id, session.expiresAt);

  await db
    .update(adminUsersTable)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(adminUsersTable.id, user.id));

  req.log.info({ adminUserId: user.id }, "admin login success");

  return res.json({
    user: publicUser(user),
  });
});

router.post("/admin/auth/logout", async (req, res) => {
  const sid = readSessionCookie(req);
  if (sid) {
    try {
      await deleteSession(sid);
    } catch (err) {
      req.log.warn({ err }, "logout: deleteSession failed");
    }
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get("/admin/auth/me", async (req, res) => {
  const sid = readSessionCookie(req);
  const user = sid ? await loadSessionUser(sid) : null;
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({ user: publicUser(user) });
});

const changeBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

router.post("/admin/auth/change-password", async (req, res) => {
  const sid = readSessionCookie(req);
  const user = sid ? await loadSessionUser(sid) : null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const parsed = changeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const ok = await verifyPassword(
    parsed.data.currentPassword,
    user.passwordHash,
  );
  if (!ok) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const policyError = validatePasswordPolicy(parsed.data.newPassword);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }
  if (parsed.data.newPassword === parsed.data.currentPassword) {
    return res.status(400).json({
      error: "New password must differ from current password",
    });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db
    .update(adminUsersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(adminUsersTable.id, user.id));

  req.log.info({ adminUserId: user.id }, "admin password changed");
  return res.json({ ok: true });
});

const forgotBody = z.object({ email: z.string().email() });

router.post("/admin/auth/forgot", async (req, res) => {
  const parsed = forgotBody.safeParse(req.body);
  // Always return 200 even on validation/lookup miss, so the endpoint
  // can't be used as an account oracle.
  const success = { ok: true };

  if (!parsed.success) return res.json(success);

  const email = parsed.data.email.toLowerCase().trim();
  const userRows = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, email))
    .limit(1);
  const user = userRows[0];
  if (!user || !user.isActive) {
    req.log.info({ email }, "admin forgot-password: unknown email");
    return res.json(success);
  }

  // Mint a single-use, 1-hour reset token. Only the SHA-256 hash is
  // stored in the DB; the raw token is sent in the email link.
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(adminPasswordResetsTable).values({
    userId: user.id,
    tokenHash: tokenHash(rawToken),
    expiresAt,
  });

  const publicHost =
    process.env.PUBLIC_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:80");
  const resetUrl = `${publicHost}/admin/reset/${rawToken}`;

  const subject = "Admin password reset link";
  const text = [
    "Hello,",
    "",
    "We received a request to reset the password for your E-Migration Assist admin account.",
    "",
    `Open this link to choose a new password (valid for 1 hour):`,
    resetUrl,
    "",
    "If you did not request this, you can ignore this email — your password will stay the same.",
    "",
    "— E-Migration Assist",
  ].join("\n");

  const sendResult = await sendCustomEmail({
    to: user.email,
    subject,
    text,
  });
  if (!sendResult.ok) {
    req.log.warn(
      { reason: sendResult.reason, userId: user.id },
      "admin forgot-password: email send failed",
    );
  } else {
    req.log.info({ userId: user.id }, "admin forgot-password: email sent");
  }

  return res.json(success);
});

const resetBody = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(1),
});

router.post("/admin/auth/reset", async (req, res) => {
  const parsed = resetBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const policyError = validatePasswordPolicy(parsed.data.newPassword);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }

  const hash = tokenHash(parsed.data.token);
  const rows = await db
    .select()
    .from(adminPasswordResetsTable)
    .where(
      and(
        eq(adminPasswordResetsTable.tokenHash, hash),
        isNull(adminPasswordResetsTable.consumedAt),
        gt(adminPasswordResetsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const reset = rows[0];
  if (!reset) {
    return res
      .status(400)
      .json({ error: "Reset link is invalid or has expired" });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db
    .update(adminUsersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(adminUsersTable.id, reset.userId));
  await db
    .update(adminPasswordResetsTable)
    .set({ consumedAt: new Date() })
    .where(eq(adminPasswordResetsTable.id, reset.id));

  req.log.info({ adminUserId: reset.userId }, "admin password reset via token");
  return res.json({ ok: true });
});

function publicUser(u: {
  id: string;
  email: string;
  displayName: string | null;
  isSuperadmin: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): {
  id: string;
  email: string;
  displayName: string | null;
  isSuperadmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
} {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isSuperadmin: u.isSuperadmin,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

export { publicUser };
export default router;
