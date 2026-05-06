import { db } from "@workspace/db";
import { adminUsersTable } from "@workspace/db/schema";
import { hashPassword } from "./adminPassword";
import { purgeExpiredSessions } from "./adminSession";
import { logger } from "./logger";

/**
 * Idempotent demo-admin seed.  Runs ONCE at server start:
 *
 *   - if `admin_users` is empty, insert a single "demo" admin
 *   - email + password are taken from `BOOTSTRAP_ADMIN_EMAIL` and
 *     `BOOTSTRAP_ADMIN_PASSWORD` if both are set, otherwise default
 *     to a fixed pair so the operator can log in immediately
 *   - password is logged at WARN level so the operator can find it
 *     in the workspace logs.  This is acceptable for a demo seed —
 *     the operator is expected to change it on first login.
 *
 * Also runs `purgeExpiredSessions()` to keep the table tidy.
 */
export async function bootstrapAdminAccounts(): Promise<void> {
  try {
    const purged = await purgeExpiredSessions();
    if (purged > 0) {
      logger.info({ purged }, "admin: purged expired sessions");
    }
  } catch (err) {
    logger.warn({ err }, "admin: session purge failed (non-fatal)");
  }

  let existingCount = 0;
  try {
    const rows = await db
      .select({ id: adminUsersTable.id })
      .from(adminUsersTable)
      .limit(1);
    existingCount = rows.length;
  } catch (err) {
    logger.error(
      { err },
      "admin: could not read admin_users table — did you run db:push?",
    );
    return;
  }
  if (existingCount > 0) {
    logger.info("admin: at least one admin user exists, skipping bootstrap");
    return;
  }

  const email = (
    process.env.BOOTSTRAP_ADMIN_EMAIL ?? "demo@admin.local"
  ).toLowerCase();
  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "ChangeMe!2026";
  const passwordHash = await hashPassword(password);

  try {
    await db.insert(adminUsersTable).values({
      email,
      passwordHash,
      displayName: "Demo Admin",
      isActive: true,
      isSuperadmin: true,
    });
  } catch (err) {
    // Race: another process inserted first.  Not a problem.
    logger.warn({ err }, "admin: bootstrap insert failed (likely race)");
    return;
  }

  // Loud, eye-catching log line so the operator can locate the seed
  // credentials quickly in the workspace log stream.
  logger.warn(
    {
      bootstrapEmail: email,
      bootstrapPassword: password,
    },
    "🔐 ADMIN SEEDED — log in at /admin/login with the credentials above. Change the password from the profile page after first login.",
  );
}
