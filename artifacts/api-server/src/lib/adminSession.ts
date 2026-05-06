import { randomBytes, createHash } from "node:crypto";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import {
  adminSessionsTable,
  adminUsersTable,
  type AdminUser,
} from "@workspace/db/schema";
import { eq, lt } from "drizzle-orm";

export const SESSION_COOKIE = "ema_admin_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generate a high-entropy opaque session id. Stored in the DB so we can
 * revoke individual sessions on logout (or list them in a future "active
 * sessions" UI).
 */
function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string): Promise<{
  id: string;
  expiresAt: Date;
}> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(adminSessionsTable).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.id, id));
}

/**
 * Look up the session id (if any) and return the active admin user it
 * belongs to.  Returns null when the cookie is absent, the row is gone,
 * the row is expired, or the user has been deactivated.
 *
 * Side effects:
 *   - expired session rows are deleted lazily as they're observed
 *   - last_seen_at is bumped on a successful read (cheap freshness signal
 *     for the future "active sessions" view)
 */
export async function loadSessionUser(
  sessionId: string,
): Promise<AdminUser | null> {
  if (!sessionId) return null;

  const sessionRows = await db
    .select()
    .from(adminSessionsTable)
    .where(eq(adminSessionsTable.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await deleteSession(session.id);
    return null;
  }

  const userRows = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, session.userId))
    .limit(1);
  const user = userRows[0];
  if (!user || !user.isActive) {
    // Account disabled — invalidate any lingering sessions for safety.
    if (user && !user.isActive) {
      await db
        .delete(adminSessionsTable)
        .where(eq(adminSessionsTable.userId, user.id));
    }
    return null;
  }

  // Bump lastSeenAt opportunistically. Errors here don't matter for auth.
  db.update(adminSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(adminSessionsTable.id, session.id))
    .catch(() => {});

  return user;
}

export function setSessionCookie(
  res: Response,
  id: string,
  expiresAt: Date,
): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
  });
}

export function readSessionCookie(req: Request): string {
  // cookieParser populates req.cookies; guard for the case where it isn't
  // mounted (e.g. tests).
  const fromParsed = (req as Request & { cookies?: Record<string, string> })
    .cookies?.[SESSION_COOKIE];
  if (typeof fromParsed === "string" && fromParsed) return fromParsed;
  return "";
}

export function tokenHash(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Best-effort cleanup of expired session rows. Called from the bootstrap
 * step on server start; not a critical path.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const r = await db
    .delete(adminSessionsTable)
    .where(lt(adminSessionsTable.expiresAt, new Date()))
    .returning({ id: adminSessionsTable.id });
  return r.length;
}
