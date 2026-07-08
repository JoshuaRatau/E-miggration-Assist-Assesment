import { test, expect } from "../support/fixtures";
import {
  adminLoginOrThrow,
  createLead,
  getAssignableUsers,
  getLead,
  patchLead,
} from "../support/api";

/**
 * Scope B — Lead qualification (admin CRM).
 *
 * All admin mutations require an authenticated admin session; the fixtures
 * log in via the real /api/admin/auth/login endpoint (no mocks).
 */

test.describe("B. Lead qualification", () => {
  test("@smoke admin can log in and see the dashboard", async ({ page }) => {
    // Business outcome: the team can access the CRM with email + password.
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill("demo@admin.local");
    await page.getByLabel(/password/i).fill("ChangeMe!2026");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/admin(?!\/login)/);
  });

  test("@smoke update lead status and it persists after refresh", async ({
    adminPage,
    request,
  }) => {
    // Business outcome: a qualifier can move a lead to "contacted" and the
    // change survives a page refresh (persisted server-side).
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const res = await patchLead(request, lead.id, { status: "contacted" });
    expect(res.ok()).toBeTruthy();

    await adminPage.goto(`/admin/lead/${lead.id}`);
    await adminPage.reload();
    await expect(
      adminPage.getByTestId("select-lead-status"),
    ).toContainText(/contacted/i);
  });

  test("assign an owner to a lead", async ({ request }) => {
    // Business outcome: every lead can have a clear owner for follow-up.
    await adminLoginOrThrow(request);
    const roster = await getAssignableUsers(request);
    expect(roster.length).toBeGreaterThan(0);

    const lead = await createLead(request);
    const res = await patchLead(request, lead.id, {
      assignedTo: roster[0].id,
    });
    expect(res.ok()).toBeTruthy();

    const after = await getLead(request, lead.id);
    expect(after.assignedTo).toBe(roster[0].id);
  });

  test("add an internal note and read it back", async ({ request }) => {
    // Business outcome: qualification context is captured against the lead
    // as an append-only note (auditable, never silently lost).
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const noteText = `E2E qualification note ${Date.now()}`;
    const res = await request.post(`/api/admin/leads/${lead.id}/notes`, {
      data: { note: noteText },
    });
    expect(res.ok()).toBeTruthy();

    const list = await request.get(`/api/admin/leads/${lead.id}/notes`);
    expect(list.ok()).toBeTruthy();
    expect(await list.text()).toContain(noteText);
  });

  test("schedule a follow-up with a note", async ({ request }) => {
    // Business outcome: the qualifier books the next touchpoint; the note is
    // tied to the due date.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const due = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const res = await patchLead(request, lead.id, {
      nextFollowUpAt: due,
      followUpNote: "E2E follow up: send pricing",
    });
    expect(res.ok()).toBeTruthy();
    const after = await getLead(request, lead.id);
    expect(after.followUpNote).toBe("E2E follow up: send pricing");
    expect(after.nextFollowUpAt).toBeTruthy();
  });

  test("changes persist after logout and re-login", async ({ request }) => {
    // Business outcome: qualification data is durable across sessions —
    // nothing lives only in the browser.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "contacted" });

    const out = await request.post("/api/admin/auth/logout");
    expect(out.ok()).toBeTruthy();
    // Session gone — admin API should now refuse.
    const denied = await request.get(`/api/admin/leads/${lead.id}/notes`);
    expect(denied.status()).toBe(401);

    await adminLoginOrThrow(request);
    const after = await getLead(request, lead.id);
    expect(after.leadStatus).toBe("contacted");
  });

  test.fixme(
    "BLOCKED: tag lead by source / city / segment via admin UI or API",
    async () => {
      // BLOCKED — prelaunch_leads has a tags[] column, but the admin PATCH
      // endpoint does not accept tags and no UI exposes tag editing. Source
      // and segment are captured at intake (funnel_context / lead_type) and
      // are read-only. To unlock: add tags to PATCH /api/admin/leads/:id and
      // a tag editor with data-testid="input-lead-tags" on the lead detail.
    },
  );
});
