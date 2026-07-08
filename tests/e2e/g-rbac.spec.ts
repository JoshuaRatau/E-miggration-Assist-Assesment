import { test, expect } from "../support/fixtures";
import { adminLogin, adminLoginOrThrow, createLead } from "../support/api";

/**
 * Scope G — RBAC / tenancy.
 *
 * Roles in this app: unauthenticated public, admin, superadmin. There is no
 * multi-tenancy (single organization) — see the fixme note.
 */

test.describe("G. RBAC", () => {
  test("@smoke unauthenticated requests cannot read leads", async ({
    request,
  }) => {
    // Business outcome: lead PII is never exposed without authentication.
    const res = await request.get("/api/leads");
    expect(res.status()).toBe(401);
  });

  test("@smoke unauthenticated visitor is pushed to the admin login page", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("wrong password is rejected", async ({ request }) => {
    const res = await adminLogin(request, "demo@admin.local", "wrong-pass!");
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("invalid legacy admin token is rejected", async ({ request }) => {
    const res = await request.get("/api/leads", {
      headers: { "x-admin-token": "not-the-real-token" },
    });
    expect(res.status()).toBe(401);
  });

  test("unauthorized users cannot perform restricted updates", async ({
    request,
  }) => {
    // Business outcome: nobody without a session can mutate a lead.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await request.post("/api/admin/auth/logout");

    const res = await request.patch(`/api/admin/leads/${lead.id}`, {
      data: { status: "contacted" },
    });
    expect(res.status()).toBe(401);
  });

  test("standard admin cannot access user management (superadmin-only)", async ({
    request,
  }) => {
    // Business outcome: only superadmins can create/disable admin accounts.
    await adminLoginOrThrow(request);

    // Create a throwaway standard (non-super) admin as the superadmin.
    const email = `e2e-standard-${Date.now()}@example.com`;
    const password = "E2eStandard!2026";
    const created = await request.post("/api/admin/users", {
      data: { email, password, displayName: "E2E Standard", isSuperadmin: false },
    });
    expect(created.ok()).toBeTruthy();
    const createdId = ((await created.json()) as { id: string }).id;

    try {
      // Re-login as the standard admin in this same context.
      await adminLoginOrThrow(request, email, password);

      const users = await request.get("/api/admin/users");
      expect(users.status()).toBe(403);

      // But the standard admin CAN see leads (allowed scope).
      const leads = await request.get("/api/leads");
      expect(leads.ok()).toBeTruthy();
    } finally {
      // Cleanup as superadmin.
      await adminLoginOrThrow(request);
      await request.delete(`/api/admin/users/${createdId}`);
    }
  });

  test.fixme("BLOCKED: cross-tenant data leakage", async () => {
    // NOT APPLICABLE / BLOCKED — this application is single-tenant (one
    // organization's CRM). There is no tenant boundary to test. If tenancy
    // is added later, seed two tenants and assert lead lists never overlap.
  });
});
