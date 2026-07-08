import { test, expect } from "../support/fixtures";
import {
  adminLoginOrThrow,
  createLead,
  getAssignableUsers,
  waitForTimelineMatch,
  patchLead,
} from "../support/api";

/**
 * Scope H — Auditability.
 *
 * Every privileged admin mutation writes an append-only lead_audit row; the
 * lead's events endpoint + activity feed expose that trail.
 */

test.describe("H. Auditability", () => {
  test("@smoke status change produces an audit/timeline entry", async ({
    request,
  }) => {
    // Business outcome: management can always answer "who moved this lead
    // and when" — status changes are traceable.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "contacted" });

    await waitForTimelineMatch(request, lead.id, "contacted");
  });

  test("note creation is captured in the audit trail", async ({
    request,
  }) => {
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const marker = `audit-note-${Date.now()}`;
    await request.post(`/api/admin/leads/${lead.id}/notes`, {
      data: { note: marker },
    });
    await waitForTimelineMatch(request, lead.id, marker);
  });

  test("assignment change is captured in the audit trail", async ({
    request,
  }) => {
    await adminLoginOrThrow(request);
    const roster = await getAssignableUsers(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { assignedTo: roster[0].id });

    await waitForTimelineMatch(request, lead.id, /assign/i);
  });

  test("audit trail is visible in the lead activity feed UI", async ({
    adminPage,
    request,
  }) => {
    // Business outcome: the audit trail is not just in the database — the
    // team can see it on the lead record.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "contacted" });

    await adminPage.goto(`/admin/lead/${lead.id}`);
    await expect(
      adminPage.getByText(/contacted/i).first(),
    ).toBeVisible();
  });
});
