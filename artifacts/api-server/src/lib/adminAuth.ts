import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

/**
 * Shared `x-admin-token` gate.
 *
 * Returns `true` if the request carries a header that timing-safe-matches
 * the `ADMIN_EMAIL_TOKEN` env var, and `false` (after writing the
 * appropriate response) otherwise.  Callers should `return` immediately
 * on `false`.
 *
 *   - 503 → server has no `ADMIN_EMAIL_TOKEN` configured at all
 *   - 401 → caller's `x-admin-token` is missing or wrong
 */
function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireAdminToken(req: Request, res: Response): boolean {
  const expected = process.env.ADMIN_EMAIL_TOKEN;
  if (!expected) {
    req.log.error(
      "ADMIN_EMAIL_TOKEN env var is not set; refusing admin endpoint",
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
      "Rejected admin endpoint — invalid or missing token",
    );
    res.status(401).json({ error: "Invalid admin token" });
    return false;
  }
  return true;
}
