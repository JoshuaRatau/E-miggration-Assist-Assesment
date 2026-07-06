import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  adminUsersTable,
  adminSessionsTable,
} from "@workspace/db/schema";
import { requireAdminAuth } from "../lib/adminAuth";
import { hashPassword, validatePasswordPolicy } from "../lib/adminPassword";
import { publicUser } from "./adminAuth";

const router: IRouter = Router();

/**
 * "Manage Admins" — superadmin-only CRUD for admin accounts.
 *
 * Endpoints (all gated by an active session belonging to a superadmin):
 *   GET    /admin/users               list
 *   POST   /admin/users               create   { email, displayName?, password? }
 *   PATCH  /admin/users/:id           update   { displayName?, isActive?, isSuperadmin? }
 *   POST   /admin/users/:id/reset     mint a new temporary password for the target
 *   DELETE /admin/users/:id           hard-delete (also kills sessions)
 */

async function gateSuperadmin(
  req: Parameters<typeof requireAdminAuth>[0],
  res: Parameters<typeof requireAdminAuth>[1],
): Promise<boolean> {
  const ok = await requireAdminAuth(req, res);
  if (!ok) return false;
  // Legacy x-admin-token requests have no `adminUser`; they are trusted
  // as superadmin (operator with the env-var token).
  const u = req.adminUser;
  if (u && !u.isSuperadmin) {
    res.status(403).json({ error: "Superadmin permission required" });
    return false;
  }
  return true;
}

router.get("/admin/users", async (req, res) => {
  if (!(await gateSuperadmin(req, res))) return;
  const rows = await db
    .select()
    .from(adminUsersTable)
    .orderBy(desc(adminUsersTable.createdAt));
  return res.json({ users: rows.map(publicUser) });
});

/**
 * GET /admin/assignable-users
 *
 * Lightweight roster of admin users for the lead-ownership picker. Unlike
 * the superadmin-only "Manage Admins" list above, ANY authenticated admin
 * may read this — assigning a lead to a colleague is a routine operational
 * action, not user administration. Returns a minimal shape (id + label +
 * active flag) so the frontend can both populate the assignee dropdown and
 * resolve a stored `assigned_to` uuid → display name across the dashboard,
 * detail page, and activity feed. All users are returned (incl. deactivated
 * ones) so historical assignments to a since-disabled account still render
 * a name rather than a bare uuid; the frontend hides inactive users from
 * the "assign" options while still using them for name resolution.
 */
router.get("/admin/assignable-users", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const rows = await db
    .select({
      id: adminUsersTable.id,
      email: adminUsersTable.email,
      displayName: adminUsersTable.displayName,
      isActive: adminUsersTable.isActive,
    })
    .from(adminUsersTable)
    .orderBy(desc(adminUsersTable.isActive), adminUsersTable.email);
  return res.json({ users: rows });
});

const createBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(120).optional(),
  password: z.string().min(1).optional(),
  isSuperadmin: z.boolean().optional(),
});

function tempPassword(): string {
  // 16 url-safe characters — readable, copyable, satisfies the policy.
  return randomBytes(12).toString("base64url");
}

router.post("/admin/users", async (req, res) => {
  if (!(await gateSuperadmin(req, res))) return;

  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, email))
    .limit(1);
  if (existing.length > 0) {
    return res
      .status(409)
      .json({ error: "An admin with that email already exists" });
  }

  const generatedPassword = parsed.data.password ?? tempPassword();
  if (parsed.data.password) {
    const policyError = validatePasswordPolicy(parsed.data.password);
    if (policyError) return res.status(400).json({ error: policyError });
  }
  const passwordHash = await hashPassword(generatedPassword);

  const insertedRows = await db
    .insert(adminUsersTable)
    .values({
      email,
      passwordHash,
      displayName: parsed.data.displayName ?? null,
      isActive: true,
      isSuperadmin: Boolean(parsed.data.isSuperadmin),
      createdById: req.adminUser?.id ?? null,
    })
    .returning();
  const created = insertedRows[0];

  req.log.info(
    { actorId: req.adminUser?.id, createdId: created.id },
    "admin user created",
  );

  return res.status(201).json({
    user: publicUser(created),
    // Returned ONCE so the creating admin can hand the password to the
    // new operator. Never stored in plaintext anywhere else.
    temporaryPassword: parsed.data.password ? null : generatedPassword,
  });
});

const patchBody = z.object({
  displayName: z.string().min(1).max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  isSuperadmin: z.boolean().optional(),
});

router.patch("/admin/users/:id", async (req, res) => {
  if (!(await gateSuperadmin(req, res))) return;
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const targetRows = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, id))
    .limit(1);
  const target = targetRows[0];
  if (!target) return res.status(404).json({ error: "Admin not found" });

  // Self-protection: a superadmin can't demote/disable themselves while
  // logged in (avoids the "locked everyone out" footgun).
  if (req.adminUser?.id === target.id) {
    if (parsed.data.isActive === false) {
      return res
        .status(400)
        .json({ error: "You cannot deactivate your own account" });
    }
    if (parsed.data.isSuperadmin === false) {
      return res
        .status(400)
        .json({ error: "You cannot remove superadmin from yourself" });
    }
  }

  const updates: Partial<typeof target> = { updatedAt: new Date() };
  if (parsed.data.displayName !== undefined)
    updates.displayName = parsed.data.displayName;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.isSuperadmin !== undefined)
    updates.isSuperadmin = parsed.data.isSuperadmin;

  const [updated] = await db
    .update(adminUsersTable)
    .set(updates)
    .where(eq(adminUsersTable.id, id))
    .returning();

  // If the target was just deactivated, kill their open sessions.
  if (parsed.data.isActive === false) {
    await db
      .delete(adminSessionsTable)
      .where(eq(adminSessionsTable.userId, id));
  }

  req.log.info(
    { actorId: req.adminUser?.id, targetId: id, patch: parsed.data },
    "admin user updated",
  );

  return res.json({ user: publicUser(updated) });
});

router.post("/admin/users/:id/reset", async (req, res) => {
  if (!(await gateSuperadmin(req, res))) return;
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const rows = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: "Admin not found" });

  const newPassword = tempPassword();
  const passwordHash = await hashPassword(newPassword);
  await db
    .update(adminUsersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(adminUsersTable.id, id));
  // Force re-login on the target.
  await db
    .delete(adminSessionsTable)
    .where(eq(adminSessionsTable.userId, id));

  req.log.warn(
    { actorId: req.adminUser?.id, targetId: id },
    "admin password reset by superadmin",
  );

  return res.json({ temporaryPassword: newPassword });
});

router.delete("/admin/users/:id", async (req, res) => {
  if (!(await gateSuperadmin(req, res))) return;
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  if (req.adminUser?.id === id) {
    return res
      .status(400)
      .json({ error: "You cannot delete your own account" });
  }

  await db
    .delete(adminSessionsTable)
    .where(eq(adminSessionsTable.userId, id));
  const r = await db
    .delete(adminUsersTable)
    .where(eq(adminUsersTable.id, id))
    .returning({ id: adminUsersTable.id });
  if (r.length === 0) {
    return res.status(404).json({ error: "Admin not found" });
  }
  req.log.warn(
    { actorId: req.adminUser?.id, targetId: id },
    "admin user deleted",
  );
  return res.json({ ok: true });
});

export default router;
