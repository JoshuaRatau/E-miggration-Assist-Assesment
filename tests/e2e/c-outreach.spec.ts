import { test, expect } from "../support/fixtures";
import {
  adminLoginOrThrow,
  createLead,
  waitForTimelineMatch,
  patchLead,
} from "../support/api";

/**
 * Scope C — Outreach workflow.
 *
 * Outreach surfaces in this funnel: the automated confirmation engagement on
 * finalize, the campaigns engine (email/WhatsApp) and per-lead follow-ups.
 * Campaign SENDS are not exercised end-to-end (they dispatch real email via
 * Resend) — see the fixme notes.
 */

test.describe("C. Outreach workflow", () => {
  test("first outreach action (status → contacted) appears in the activity timeline", async ({
    request,
  }) => {
    // Business outcome: when a rep reaches out and marks the lead contacted,
    // the action is logged in the lead's activity history.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "contacted" });

    await waitForTimelineMatch(request, lead.id, "contacted");
  });

  test("follow-up task is created and completing it stamps last-contacted", async ({
    request,
  }) => {
    // Business outcome: outreach creates a next-step reminder; completing it
    // records that contact actually happened.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const due = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await patchLead(request, lead.id, {
      nextFollowUpAt: due,
      followUpNote: "E2E: intro call",
    });

    const done = await request.post(
      `/api/admin/leads/${lead.id}/follow-up/complete`,
    );
    expect(done.ok()).toBeTruthy();

    const after = await request.get(`/api/leads/by-id/${lead.id}`);
    const detail = (await after.json()) as {
      lastContactedAt?: string | null;
      nextFollowUpAt?: string | null;
    };
    expect(detail.lastContactedAt).toBeTruthy();
    expect(detail.nextFollowUpAt).toBeFalsy();
  });

  test("outreach timeline is visible on the lead detail page", async ({
    adminPage,
    request,
  }) => {
    // Business outcome: a rep opening the lead sees the activity history.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "contacted" });

    await adminPage.goto(`/admin/lead/${lead.id}`);
    await expect(
      adminPage.getByText(/activity|timeline|history/i).first(),
    ).toBeVisible();
  });

  test("communication templates hub is reachable", async ({ adminPage }) => {
    // Business outcome: the team can manage reusable outreach templates.
    await adminPage.goto("/admin/communications");
    await expect(
      adminPage.getByText(/communications|campaigns|templates/i).first(),
    ).toBeVisible();
  });

  test.fixme(
    "BLOCKED: end-to-end campaign email send with message record verification",
    async () => {
      // BLOCKED — sending a campaign dispatches REAL email through Resend to
      // the recipient list; running this in an automated suite would send
      // live email. To unlock: add an env-gated email transport stub
      // (e.g. E2E_EMAIL_SINK=1 writes to a table instead of Resend), then
      // assert the campaign_recipients rows and delivery counters.
    },
  );

  test.fixme(
    "BLOCKED: confirmation email/WhatsApp engagement record on finalize",
    async () => {
      // BLOCKED for the same reason — POST /api/leads/:id/finalize triggers a
      // real confirmation send. The at-most-once finalize contract is
      // documented; verifying the engagement row requires the email sink
      // stub above to avoid dispatching live messages from CI.
    },
  );
});
