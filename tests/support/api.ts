import type { APIRequestContext, APIResponse } from "@playwright/test";

/** Admin credentials — seeded demo superadmin unless overridden via env. */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "demo@admin.local";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "ChangeMe!2026";

let counter = 0;

/** Unique, obviously-synthetic test identity per call. */
export function testIdentity(label = "e2e") {
  counter += 1;
  const nonce = `${Date.now().toString(36)}${counter}`;
  return {
    fullName: `E2E Test ${label} ${nonce}`,
    email: `e2e-${label}-${nonce}@example.com`,
    // +27 followed by 9 digits — passes the "+ then 8-15 digits" rule.
    whatsapp: `+27${String(700000000 + Math.floor(Math.random() * 99999999))}`,
  };
}

export interface CreateLeadOptions {
  fullName?: string;
  email?: string;
  whatsapp?: string;
  finalize?: boolean;
  extra?: Record<string, unknown>;
}

/**
 * Create a lead via the public API (the same endpoint the assessment funnel
 * submits to). finalize defaults to false so NO confirmation email/WhatsApp
 * is dispatched for test data.
 */
export async function createLeadRaw(
  request: APIRequestContext,
  opts: CreateLeadOptions = {},
): Promise<APIResponse> {
  const id = testIdentity();
  return request.post("/api/leads", {
    data: {
      fullName: opts.fullName ?? id.fullName,
      email: opts.email ?? id.email,
      whatsapp: opts.whatsapp ?? id.whatsapp,
      nationality: "Nigeria",
      immigrationSituation: "visa_required",
      countryOfResidence: "Nigeria",
      currentlyInSouthAfrica: false,
      consentAccepted: true,
      finalize: opts.finalize ?? false,
      ...(opts.extra ?? {}),
    },
  });
}

export async function createLead(
  request: APIRequestContext,
  opts: CreateLeadOptions = {},
): Promise<{ id: string; referenceNumber?: string; email: string }> {
  const res = await createLeadRaw(request, opts);
  if (res.status() !== 201) {
    throw new Error(
      `createLead expected 201, got ${res.status()}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    id: string;
    referenceNumber?: string;
    email?: string;
  };
  return {
    id: body.id,
    referenceNumber: body.referenceNumber,
    email: (opts.email ?? body.email ?? "") as string,
  };
}

/** Login as admin; session cookie lands in the request context's cookie jar. */
export async function adminLogin(
  request: APIRequestContext,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<APIResponse> {
  return request.post("/api/admin/auth/login", { data: { email, password } });
}

export async function adminLoginOrThrow(
  request: APIRequestContext,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<void> {
  const res = await adminLogin(request, email, password);
  if (!res.ok()) {
    throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
  }
}

/** PATCH an admin lead (status / assignment / follow-up / etc). */
export async function patchLead(
  request: APIRequestContext,
  leadId: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return request.patch(`/api/admin/leads/${leadId}`, { data });
}

/** Walk a lead through the forward pipeline to the target status. */
export async function advanceLeadTo(
  request: APIRequestContext,
  leadId: string,
  target: string,
): Promise<void> {
  // Conversion readiness requires a matter type (derived from inquiryType) —
  // set it up-front so leads walked to ready_for_case/converted can convert.
  await patchLead(request, leadId, { inquiryType: "visa_inquiry" });
  const path = [
    "contacted",
    "engaged",
    "qualified",
    "proposal_sent",
    "ready_for_case",
    "converted",
  ];
  for (const status of path) {
    const res = await patchLead(request, leadId, { status });
    if (!res.ok()) {
      throw new Error(
        `advanceLeadTo(${target}) failed at ${status}: ${res.status()} ${await res.text()}`,
      );
    }
    if (status === target) return;
  }
  throw new Error(`unknown target status ${target}`);
}

/** Roster of active admin users a lead can be assigned to. */
export async function getAssignableUsers(
  request: APIRequestContext,
): Promise<Array<{ id: string; email: string }>> {
  const res = await request.get("/api/admin/assignable-users");
  if (!res.ok()) throw new Error(`assignable-users ${res.status()}`);
  const body = (await res.json()) as {
    users: Array<{ id: string; email: string }>;
  };
  return body.users;
}

/** The lead's audit/engagement timeline (what the activity feed renders). */
export async function getTimelineText(
  request: APIRequestContext,
  leadId: string,
): Promise<string> {
  const res = await request.get(`/api/admin/leads/${leadId}/timeline`);
  if (!res.ok()) throw new Error(`timeline ${res.status()}`);
  return res.text();
}

/**
 * Audit rows are written fire-and-forget server-side, so a timeline read can
 * momentarily lag the mutation that produced it. Poll until the expected
 * marker appears (or time out) instead of asserting on a single read.
 */
export async function waitForTimelineMatch(
  request: APIRequestContext,
  leadId: string,
  matcher: string | RegExp,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    last = await getTimelineText(request, leadId);
    const hit =
      typeof matcher === "string" ? last.includes(matcher) : matcher.test(last);
    if (hit) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `timeline never matched ${matcher} within ${timeoutMs}ms; last: ${last.slice(0, 500)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function getLead(
  request: APIRequestContext,
  leadId: string,
): Promise<Record<string, unknown>> {
  const res = await request.get(`/api/leads/by-id/${leadId}`);
  if (!res.ok()) throw new Error(`getLead ${res.status()}`);
  return (await res.json()) as Record<string, unknown>;
}
