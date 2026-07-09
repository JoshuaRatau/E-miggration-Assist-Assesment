# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a-lead-capture.spec.ts >> A. Lead capture >> invalid phone (WhatsApp) format is rejected
- Location: e2e/a-lead-capture.spec.ts:63:3

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    201
```

# Test source

```ts
  1   | import { test, expect } from "../support/fixtures";
  2   | import { createLead, createLeadRaw, testIdentity } from "../support/api";
  3   | 
  4   | /**
  5   |  * Scope A — Lead capture.
  6   |  *
  7   |  * The public capture surface is the assessment funnel (/assessment) plus two
  8   |  * segment funnels (/business, /overstay). The funnel submits to the public
  9   |  * POST /api/leads endpoint (two-phase: create with finalize:false, then
  10  |  * finalize at the end). UI walk beyond the contact step is OTP-gated (a real
  11  |  * email/WhatsApp code is required), so the full UI happy path is BLOCKED —
  12  |  * see the fixme at the bottom; the submission contract is covered at the
  13  |  * API layer, which is the exact request the funnel sends.
  14  |  */
  15  | 
  16  | test.describe("A. Lead capture", () => {
  17  |   test("@smoke funnel entry point renders and starts the assessment", async ({
  18  |     page,
  19  |   }) => {
  20  |     // Business outcome: a prospect landing on /assessment can begin the flow.
  21  |     await page.goto("/assessment");
  22  |     await expect(page.getByTestId("select-nationality")).toBeVisible();
  23  |   });
  24  | 
  25  |   test("@smoke lead is created and saved with a reference number", async ({
  26  |     request,
  27  |   }) => {
  28  |     // Business outcome: a completed funnel submission persists a lead the
  29  |     // team can work, and the applicant gets a trackable reference.
  30  |     const lead = await createLead(request);
  31  |     expect(lead.id).toBeTruthy();
  32  |     expect(lead.referenceNumber).toMatch(/^EMA-/);
  33  |   });
  34  | 
  35  |   test("required fields are enforced (missing full name rejected)", async ({
  36  |     request,
  37  |   }) => {
  38  |     // Business outcome: incomplete submissions never create half-formed leads.
  39  |     const id = testIdentity("noname");
  40  |     const res = await request.post("/api/leads", {
  41  |       data: { email: id.email, consentAccepted: true, finalize: false },
  42  |     });
  43  |     expect(res.status()).toBeGreaterThanOrEqual(400);
  44  |     expect(res.status()).toBeLessThan(500);
  45  |   });
  46  | 
  47  |   test("invalid email is rejected", async ({ request }) => {
  48  |     // KNOWN DEFECT (see docs/leads-funnel-defect-log-template.md, DEF-001):
  49  |     // the API accepts any string as an email (no format validation server-
  50  |     // side) and returns 201. Business requirement: reject undeliverable
  51  |     // addresses. test.fail() = this test PASSES only while the defect
  52  |     // exists; once the API validates email format, remove the marker.
  53  |     test.fail();
  54  |     // Unique per run — a fixed string collides with the duplicate-email 409
  55  |     // guard on reruns, which would mask the missing format validation.
  56  |     const res = await createLeadRaw(request, {
  57  |       email: `not-an-email-${Date.now()}`,
  58  |     });
  59  |     expect(res.status()).toBeGreaterThanOrEqual(400);
  60  |     expect(res.status()).toBeLessThan(500);
  61  |   });
  62  | 
  63  |   test("invalid phone (WhatsApp) format is rejected", async ({ request }) => {
  64  |     // KNOWN DEFECT (DEF-002): an invalid WhatsApp number ("12345") is not
  65  |     // rejected — the server silently normalizes it away and stores the lead
  66  |     // WITHOUT a usable phone number, returning 201. Business requirement:
  67  |     // tell the applicant their number is invalid so they can fix it.
  68  |     test.fail();
  69  |     const res = await createLeadRaw(request, { whatsapp: "12345" });
> 70  |     expect(res.status()).toBeGreaterThanOrEqual(400);
      |                          ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  71  |     expect(res.status()).toBeLessThan(500);
  72  |   });
  73  | 
  74  |   test("consent is mandatory", async ({ request }) => {
  75  |     // Business outcome: POPIA — no lead is stored without explicit consent.
  76  |     const res = await createLeadRaw(request, {
  77  |       extra: { consentAccepted: false },
  78  |     });
  79  |     expect(res.status()).toBeGreaterThanOrEqual(400);
  80  |     expect(res.status()).toBeLessThan(500);
  81  |   });
  82  | 
  83  |   test("business funnel rejects a submission without a firm name", async ({
  84  |     request,
  85  |   }) => {
  86  |     // Business outcome: B2B intake without the company name is unusable and
  87  |     // must be rejected server-side (spec: "missing company name").
  88  |     const id = testIdentity("firm");
  89  |     const res = await request.post("/api/business-intake", {
  90  |       data: {
  91  |         fullName: id.fullName,
  92  |         email: id.email,
  93  |         consentAccepted: true,
  94  |       },
  95  |     });
  96  |     expect(res.status()).toBeGreaterThanOrEqual(400);
  97  |     expect(res.status()).toBeLessThan(500);
  98  |   });
  99  | 
  100 |   test("duplicate lead (same email) is rejected with 409", async ({
  101 |     request,
  102 |   }) => {
  103 |     // Business outcome: re-submitting the funnel does not create duplicate
  104 |     // CRM records for the same person.
  105 |     const email = testIdentity("dup").email;
  106 |     await createLead(request, { email });
  107 |     const dup = await createLeadRaw(request, { email });
  108 |     expect(dup.status()).toBe(409);
  109 |   });
  110 | 
  111 |   test("duplicate lead (same WhatsApp number) is rejected with 409", async ({
  112 |     request,
  113 |   }) => {
  114 |     const whatsapp = testIdentity("dupwa").whatsapp;
  115 |     await createLead(request, { whatsapp });
  116 |     const dup = await createLeadRaw(request, { whatsapp });
  117 |     expect(dup.status()).toBe(409);
  118 |   });
  119 | 
  120 |   test("bot submissions (honeypot filled) are silently discarded", async ({
  121 |     request,
  122 |   }) => {
  123 |     // Business outcome: spam bots that fill the hidden `website` field get a
  124 |     // fake success (so they don't adapt) but NO lead row is created.
  125 |     const res = await createLeadRaw(request, {
  126 |       extra: { website: "http://spam.example.com" },
  127 |     });
  128 |     expect(res.status()).toBe(201);
  129 |     const body = (await res.json()) as { id?: string };
  130 |     if (body.id) {
  131 |       // Lead lookup is admin-only; authenticate to prove no row was stored.
  132 |       const { adminLoginOrThrow } = await import("../support/api");
  133 |       await adminLoginOrThrow(request);
  134 |       const lookup = await request.get(`/api/leads/by-id/${body.id}`);
  135 |       expect(lookup.status()).toBe(404);
  136 |     }
  137 |   });
  138 | 
  139 |   test("confirmation: thank-you page shows the lead reference", async ({
  140 |     page,
  141 |     request,
  142 |   }) => {
  143 |     // Business outcome: after submitting, the applicant sees their reference
  144 |     // number on the confirmation page.
  145 |     const lead = await createLead(request);
  146 |     await page.goto(`/thank-you/${lead.referenceNumber}`);
  147 |     await expect(
  148 |       page.getByText(lead.referenceNumber as string).first(),
  149 |     ).toBeVisible();
  150 |   });
  151 | 
  152 |   test.fixme(
  153 |     "BLOCKED: full UI walk through all funnel steps to submission",
  154 |     async () => {
  155 |       // BLOCKED — the funnel's OTP step requires a real one-time code sent to
  156 |       // email/WhatsApp; there is no E2E_OTP_BYPASS hook in the app. To unlock:
  157 |       // add a dev-only OTP bypass (env-gated) or a mailbox/OTP test fixture.
  158 |       // The submission contract itself is covered by the API tests above.
  159 |     },
  160 |   );
  161 | });
  162 | 
```