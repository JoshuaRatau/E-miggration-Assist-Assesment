import { test, expect } from "../support/fixtures";
import {
  adminLoginOrThrow,
  createLead,
  createLeadRaw,
  patchLead,
  testIdentity,
} from "../support/api";

/**
 * Scope F — Negative and resilience scenarios.
 */

test.describe("F. Negative & resilience", () => {
  test("@smoke incomplete assessment form cannot advance", async ({
    page,
  }) => {
    // Business outcome: a visitor cannot skip required answers; the funnel
    // holds them on the current step instead of storing junk.
    await page.goto("/assessment");
    await expect(page.getByTestId("select-nationality")).toBeVisible();
    const next = page
      .getByRole("button", { name: /next|continue/i })
      .first();
    if (await next.isVisible().catch(() => false)) {
      const before = page.url();
      await next.click();
      // Still on the funnel — either same URL or the nationality field
      // remains visible (step did not advance).
      await expect(page.getByTestId("select-nationality")).toBeVisible();
      expect(page.url()).toBe(before);
    }
  });

  test("invalid pipeline transition is rejected and state is untouched", async ({
    request,
  }) => {
    // Business outcome: the pipeline cannot be corrupted by an illegal jump.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const res = await patchLead(request, lead.id, { status: "converted" });
    expect(res.status()).toBe(409);
    const detail = await request.get(`/api/leads/by-id/${lead.id}`);
    expect(((await detail.json()) as { leadStatus: string }).leadStatus).toBe(
      "new",
    );
  });

  test("bogus status value is rejected with 400", async ({ request }) => {
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const res = await patchLead(request, lead.id, { status: "abducted" });
    expect(res.status()).toBe(400);
  });

  test("double submission (refresh during save) does not create two leads", async ({
    request,
  }) => {
    // Business outcome: a user double-clicking submit or refreshing during
    // save ends up with exactly one lead (second attempt → 409 duplicate).
    const id = testIdentity("resubmit");
    const [first, second] = await Promise.all([
      createLeadRaw(request, { email: id.email, whatsapp: id.whatsapp }),
      createLeadRaw(request, { email: id.email, whatsapp: id.whatsapp }),
    ]);
    const statuses = [first.status(), second.status()].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);
  });

  test("browser back/forward across funnel pages does not crash the app", async ({
    page,
  }) => {
    // Business outcome: normal browser navigation never white-screens the
    // funnel or loses the page shell.
    await page.goto("/assessment");
    await expect(page.getByTestId("select-nationality")).toBeVisible();
    await page.goto("/status");
    await page.goBack();
    await expect(page.getByTestId("select-nationality")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/status/);
  });

  test("unknown admin route degrades gracefully (no server error)", async ({
    adminPage,
  }) => {
    const response = await adminPage.goto("/admin/definitely-not-a-page");
    // SPA fallback: server still returns the app shell, not a 5xx.
    expect(response?.status() ?? 200).toBeLessThan(500);
  });

  test.fixme(
    "BLOCKED: graceful behavior when the email provider is down",
    async () => {
      // BLOCKED — simulating a Resend outage requires a fault-injection hook
      // (e.g. E2E_FAIL_EMAIL=1) or a network-level stub for the provider,
      // neither of which exists. The code path is designed fire-and-forget
      // (send failures are logged, the 201 is never masked) but this cannot
      // be proven end-to-end without the hook.
    },
  );
});
