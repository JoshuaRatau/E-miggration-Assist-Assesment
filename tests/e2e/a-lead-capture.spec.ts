import { test, expect } from "../support/fixtures";
import { createLead, createLeadRaw, testIdentity } from "../support/api";

/**
 * Scope A — Lead capture.
 *
 * The public capture surface is the assessment funnel (/assessment) plus two
 * segment funnels (/business, /overstay). The funnel submits to the public
 * POST /api/leads endpoint (two-phase: create with finalize:false, then
 * finalize at the end). UI walk beyond the contact step is OTP-gated (a real
 * email/WhatsApp code is required), so the full UI happy path is BLOCKED —
 * see the fixme at the bottom; the submission contract is covered at the
 * API layer, which is the exact request the funnel sends.
 */

test.describe("A. Lead capture", () => {
  test("@smoke funnel entry point renders and starts the assessment", async ({
    page,
  }) => {
    // Business outcome: a prospect landing on /assessment can begin the flow.
    await page.goto("/assessment");
    await expect(page.getByTestId("select-nationality")).toBeVisible();
  });

  test("@smoke lead is created and saved with a reference number", async ({
    request,
  }) => {
    // Business outcome: a completed funnel submission persists a lead the
    // team can work, and the applicant gets a trackable reference.
    const lead = await createLead(request);
    expect(lead.id).toBeTruthy();
    expect(lead.referenceNumber).toMatch(/^EMA-/);
  });

  test("required fields are enforced (missing full name rejected)", async ({
    request,
  }) => {
    // Business outcome: incomplete submissions never create half-formed leads.
    const id = testIdentity("noname");
    const res = await request.post("/api/leads", {
      data: { email: id.email, consentAccepted: true, finalize: false },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("invalid email is rejected", async ({ request }) => {
    // KNOWN DEFECT (see docs/leads-funnel-defect-log-template.md, DEF-001):
    // the API accepts any string as an email (no format validation server-
    // side) and returns 201. Business requirement: reject undeliverable
    // addresses. test.fail() = this test PASSES only while the defect
    // exists; once the API validates email format, remove the marker.
    test.fail();
    // Unique per run — a fixed string collides with the duplicate-email 409
    // guard on reruns, which would mask the missing format validation.
    const res = await createLeadRaw(request, {
      email: `not-an-email-${Date.now()}`,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("invalid phone (WhatsApp) format is rejected", async ({ request }) => {
    // KNOWN DEFECT (DEF-002): an invalid WhatsApp number ("12345") is not
    // rejected — the server silently normalizes it away and stores the lead
    // WITHOUT a usable phone number, returning 201. Business requirement:
    // tell the applicant their number is invalid so they can fix it.
    test.fail();
    const res = await createLeadRaw(request, { whatsapp: "12345" });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("consent is mandatory", async ({ request }) => {
    // Business outcome: POPIA — no lead is stored without explicit consent.
    const res = await createLeadRaw(request, {
      extra: { consentAccepted: false },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("business funnel rejects a submission without a firm name", async ({
    request,
  }) => {
    // Business outcome: B2B intake without the company name is unusable and
    // must be rejected server-side (spec: "missing company name").
    const id = testIdentity("firm");
    const res = await request.post("/api/business-intake", {
      data: {
        fullName: id.fullName,
        email: id.email,
        consentAccepted: true,
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("duplicate lead (same email) is rejected with 409", async ({
    request,
  }) => {
    // Business outcome: re-submitting the funnel does not create duplicate
    // CRM records for the same person.
    const email = testIdentity("dup").email;
    await createLead(request, { email });
    const dup = await createLeadRaw(request, { email });
    expect(dup.status()).toBe(409);
  });

  test("duplicate lead (same WhatsApp number) is rejected with 409", async ({
    request,
  }) => {
    const whatsapp = testIdentity("dupwa").whatsapp;
    await createLead(request, { whatsapp });
    const dup = await createLeadRaw(request, { whatsapp });
    expect(dup.status()).toBe(409);
  });

  test("bot submissions (honeypot filled) are silently discarded", async ({
    request,
  }) => {
    // Business outcome: spam bots that fill the hidden `website` field get a
    // fake success (so they don't adapt) but NO lead row is created.
    const res = await createLeadRaw(request, {
      extra: { website: "http://spam.example.com" },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id?: string };
    if (body.id) {
      // Lead lookup is admin-only; authenticate to prove no row was stored.
      const { adminLoginOrThrow } = await import("../support/api");
      await adminLoginOrThrow(request);
      const lookup = await request.get(`/api/leads/by-id/${body.id}`);
      expect(lookup.status()).toBe(404);
    }
  });

  test("confirmation: thank-you page shows the lead reference", async ({
    page,
    request,
  }) => {
    // Business outcome: after submitting, the applicant sees their reference
    // number on the confirmation page.
    const lead = await createLead(request);
    await page.goto(`/thank-you/${lead.referenceNumber}`);
    await expect(
      page.getByText(lead.referenceNumber as string).first(),
    ).toBeVisible();
  });

  test.fixme(
    "BLOCKED: full UI walk through all funnel steps to submission",
    async () => {
      // BLOCKED — the funnel's OTP step requires a real one-time code sent to
      // email/WhatsApp; there is no E2E_OTP_BYPASS hook in the app. To unlock:
      // add a dev-only OTP bypass (env-gated) or a mailbox/OTP test fixture.
      // The submission contract itself is covered by the API tests above.
    },
  );
});
