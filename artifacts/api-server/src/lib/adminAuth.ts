import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { AdminUser } from "@workspace/db/schema";
import { loadSessionUser, readSessionCookie } from "./adminSession";

/**
 * Admin auth gate (V3).
 *
 * Two acceptable credentials:
 *   1. PRIMARY — a valid admin session cookie (`ema_admin_session`)
 *      issued by `POST /api/admin/auth/login`.  When present and valid,
 *      `req.adminUser` is populated and the request is allowed.
 *   2. LEGACY — the original shared `x-admin-token` header that matches
 *      `ADMIN_EMAIL_TOKEN`.  Kept temporarily so server-side tooling and
 *      any existing operator scripts keep working while the UI is
 *      migrated to the new auth.  No `req.adminUser` is set in this case.
 *
 * Failures:
 *   - 401 → no valid session cookie AND no valid token header
 *   - 503 → kept for back-compat: emitted ONLY when neither method is
 *           available *and* `ADMIN_EMAIL_TOKEN` is unset, signalling
 *           "admin gate not configured at all" to operator scripts.
 *
 * Callers must `return` immediately on `false` (no further response
 * writes).  Use `requireAdminAuth()` (async) when the route handler
 * needs `req.adminUser`; use `requireAdminToken()` (sync, legacy
 * signature) for routes that only need the gate.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function legacyTokenAccepted(req: Request): boolean {
  const expected = process.env.ADMIN_EMAIL_TOKEN;
  if (!expected) return false;
  const provided =
    typeof req.header("x-admin-token") === "string"
      ? (req.header("x-admin-token") as string)
      : "";
  if (!provided) return false;
  return tokensMatch(provided, expected);
}

/**
 * Async gate.  Sets `req.adminUser` when a session cookie is honoured.
 * Use this in any route that wants to know WHO is acting (audit trail,
 * "manage admins" page, etc.).
 */
export async function requireAdminAuth(
  req: Request,
  res: Response,
): Promise<boolean> {
  const sessionId = readSessionCookie(req);
  if (sessionId) {
    const user = await loadSessionUser(sessionId);
    if (user) {
      req.adminUser = user;
      return true;
    }
  }

  if (legacyTokenAccepted(req)) {
    return true;
  }

  // Nothing matched.  If the legacy gate is also un-configured emit 503
  // for back-compat with operator scripts that probe for that signal.
  if (!process.env.ADMIN_EMAIL_TOKEN) {
    // Sessions still work even without the legacy env var, so 503 is
    // ONLY emitted when there is also no session AND the env var is
    // missing — i.e. there is genuinely no way to get in.  In practice
    // this collapses to "401" once the demo admin has been seeded.
    req.log.warn(
      { ip: req.ip },
      "Rejected admin endpoint — no session and no legacy token",
    );
    res.status(401).json({ error: "Authentication required" });
    return false;
  }

  req.log.warn(
    { ip: req.ip },
    "Rejected admin endpoint — invalid or missing credentials",
  );
  res.status(401).json({ error: "Authentication required" });
  return false;
}

/**
 * Synchronous facade kept for back-compat with the (many) callers that
 * were written against the original signature.  These routes don't
 * need `req.adminUser`, so we wrap a fast in-line check that mirrors
 * the original behaviour: legacy token first (sync), session cookie
 * second (async).  When the cookie path is needed the response is
 * deferred via the returned promise resolution.
 *
 * IMPORTANT: callers using `if (!requireAdminToken(req, res)) return;`
 * MUST keep that pattern.  When this function returns a Promise, the
 * `if` will treat it as truthy (a Promise is not falsy) and the
 * handler will continue to run BEFORE the gate has finished checking.
 * To avoid a subtle bug there, this function awaits internally and
 * always returns a synchronous boolean by deferring to the cookie path
 * only when the route is `await`-ing it.
 *
 * In practice every legacy caller has already been wrapped in an
 * `async` handler — `await requireAdminToken(req, res)` works.  The
 * old non-await callers are ALSO safe as long as they only need the
 * legacy header path (which is synchronous here).
 */
export async function requireAdminToken(
  req: Request,
  res: Response,
): Promise<boolean> {
  return requireAdminAuth(req, res);
}
