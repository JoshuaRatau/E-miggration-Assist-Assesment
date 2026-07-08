import { test, expect } from "../support/fixtures";
import {
  adminLoginOrThrow,
  createLead,
  getAssignableUsers,
  patchLead,
} from "../support/api";

/**
 * Scope E — Pipeline visibility.
 *
 * The pipeline surfaces are the admin dashboard lead list (with status
 * filter) and the derived stage counts from GET /api/leads?status=...
 */

test.describe("E. Pipeline visibility", () => {
  test("@smoke a new lead appears in the dashboard list", async ({
    adminPage,
    request,
  }) => {
    // Business outcome: a fresh funnel submission is immediately visible to
    // the team in the CRM.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await adminPage.goto("/admin");
    await expect(
      adminPage.getByTestId(`row-lead-${lead.referenceNumber}`),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("lead shows in the correct pipeline stage after a status change", async ({
    request,
  }) => {
    // Business outcome: stage views are trustworthy — a lead moved to
    // "qualified" appears in the qualified bucket, and only there.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "contacted" });
    await patchLead(request, lead.id, { status: "engaged" });
    await patchLead(request, lead.id, { status: "qualified" });

    const inStage = await request.get("/api/leads?status=qualified");
    expect(inStage.ok()).toBeTruthy();
    const rows = (await inStage.json()) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === lead.id)).toBe(true);

    const oldStage = await request.get("/api/leads?status=new");
    const oldRows = (await oldStage.json()) as Array<{ id: string }>;
    expect(oldRows.some((r) => r.id === lead.id)).toBe(false);
  });

  test("stage counts update when a lead changes stage", async ({
    request,
  }) => {
    // Business outcome: dashboard counts stay accurate as leads move.
    // Uses the sparsely-populated proposal_sent stage — the busy "new"
    // stage exceeds the list's page cap, making raw counts there unstable.
    await adminLoginOrThrow(request);
    const count = async (status: string) => {
      const res = await request.get(`/api/leads?status=${status}`);
      return ((await res.json()) as unknown[]).length;
    };
    const lead = await createLead(request);
    const before = await count("proposal_sent");

    for (const s of ["contacted", "engaged", "qualified", "proposal_sent"]) {
      await patchLead(request, lead.id, { status: s });
    }

    expect(await count("proposal_sent")).toBe(before + 1);
  });

  test("dashboard status filter narrows the list", async ({
    adminPage,
    request,
  }) => {
    // Business outcome: the team can slice the pipeline by stage in the UI.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { status: "qualified" });

    await adminPage.goto("/admin");
    const filter = adminPage.getByTestId("select-filter-status");
    await expect(filter).toBeVisible();
    await filter.click();
    await adminPage.getByRole("option", { name: /qualified/i }).click();
    await expect(
      adminPage.getByTestId(`row-lead-${lead.referenceNumber}`),
    ).toBeVisible();
  });

  test("filter by owner via API query", async ({ request }) => {
    // Business outcome: a rep can pull up "my leads".
    await adminLoginOrThrow(request);
    const roster = await getAssignableUsers(request);
    const lead = await createLead(request);
    await patchLead(request, lead.id, { assignedTo: roster[0].id });

    const mine = await request.get(`/api/leads?assignedTo=${roster[0].id}`);
    expect(mine.ok()).toBeTruthy();
    const rows = (await mine.json()) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === lead.id)).toBe(true);
  });

  test.fixme(
    "BLOCKED: search / sort by city and source in the dashboard UI",
    async () => {
      // PARTIALLY BLOCKED — the dashboard has a status filter and an
      // assigned-to filter chip, but no city or source sort/search controls
      // with stable selectors. To unlock: add data-testid="input-lead-search",
      // data-testid="select-filter-source", data-testid="sort-leads" to the
      // dashboard toolbar.
    },
  );
});
