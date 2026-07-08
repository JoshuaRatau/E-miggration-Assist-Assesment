import { test, expect } from "../support/fixtures";
import {
  adminLoginOrThrow,
  advanceLeadTo,
  createLead,
  patchLead,
} from "../support/api";

/**
 * Scope D — Demo booking / conversion path.
 *
 * This funnel has NO demo-booking feature (no calendar, no booking entity).
 * Its conversion path is: lead pipeline → ready_for_case → converted, which
 * creates an EMA case. Booking-specific items are BLOCKED (feature absent);
 * the conversion state machine is covered fully.
 */

test.describe("D. Conversion path", () => {
  test("@smoke disallowed transition: cannot convert before ready_for_case", async ({
    request,
  }) => {
    // Business outcome: nobody can skip qualification and mark a raw lead
    // converted — the pipeline gate is enforced server-side.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    const res = await patchLead(request, lead.id, { status: "converted" });
    expect(res.status()).toBe(409);
  });

  test("@smoke allowed path: ready_for_case → converted creates a case", async ({
    request,
  }) => {
    // Business outcome: converting a fully-qualified lead opens a case the
    // team can work in the case pipeline.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await advanceLeadTo(request, lead.id, "ready_for_case");

    const res = await patchLead(request, lead.id, { status: "converted" });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { caseId?: string | null };
    expect(body.caseId).toBeTruthy();
  });

  test("conversion is idempotent — converting again does not duplicate the case", async ({
    request,
  }) => {
    // Business outcome: retries/double-clicks never open a second case.
    // Note: the explicit POST /convert route has a readiness gate that needs
    // inquiryType (not settable via the public funnel or admin PATCH), so
    // the case is created via the status→converted path here and /convert
    // is exercised as the idempotent retry — it must short-circuit and
    // return the SAME case, never a duplicate.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await advanceLeadTo(request, lead.id, "converted");
    const converted = (await (
      await request.get(`/api/leads/by-id/${lead.id}`)
    ).json()) as { caseId?: string };
    expect(converted.caseId).toBeTruthy();

    const retry = await request.post(`/api/admin/leads/${lead.id}/convert`);
    expect(retry.ok()).toBeTruthy();
    const body = (await retry.json()) as {
      alreadyConverted?: boolean;
      lead?: { caseId?: string };
    };
    expect(body.alreadyConverted).toBeTruthy();
    expect(body.lead?.caseId).toBe(converted.caseId);
  });

  test("converted state is reflected on the lead record page", async ({
    adminPage,
    request,
  }) => {
    // Business outcome: anyone opening the lead sees it is converted and can
    // reach the linked case.
    await adminLoginOrThrow(request);
    const lead = await createLead(request);
    await advanceLeadTo(request, lead.id, "converted");

    await adminPage.goto(`/admin/lead/${lead.id}`);
    await expect(
      adminPage.getByText(/converted/i).first(),
    ).toBeVisible();
  });

  test.fixme("BLOCKED: demo booking fields, date/time handling", async () => {
    // BLOCKED — there is no demo-booking feature in this application (no
    // booking form, calendar, or booking entity). The nearest business
    // equivalent, per-lead follow-up scheduling, is covered in Scope B/C.
    // To unlock: build a demo-booking feature, then test booking fields,
    // timezone handling, and pipeline reflection here.
  });
});
