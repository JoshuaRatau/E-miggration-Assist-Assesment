import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rows: [] as any[][], finalize: vi.fn(), save: vi.fn(), confirmation: vi.fn(), event: vi.fn(async () => {}),
}));
vi.mock("@workspace/db", async () => {
  // Schema definitions only, NEVER the connection-bearing package entrypoint.
  const schema = await import("@workspace/db/schema");
  const chain: any = {};
  for (const method of ["select", "from", "where", "orderBy"]) chain[method] = () => chain;
  chain.limit = async () => mocks.rows.shift() ?? [];
  return { ...schema, db: chain };
});
vi.mock("../ghl/snapshots", () => ({ finalizeAssessment: mocks.finalize, saveAssessment: mocks.save }));
vi.mock("../intakePersistence", () => ({ saveIntakeAssessment: mocks.save, sendIntakeOutcome: () => false }));
vi.mock("../confirmation", () => ({ buildConfirmationDispatcher: () => mocks.confirmation }));
vi.mock("../recordLeadEvent", () => ({ recordLeadEvent: mocks.event }));
vi.mock("../adminAuth", () => ({ requireAdminToken: vi.fn() }));
vi.mock("../otp", () => ({ findUsableVerifiedOtp: vi.fn() }));
vi.mock("../rateLimit", () => ({ createRateBucket: () => ({ hit: () => ({ ok: true }) }) }));
import individual from "../../routes/leads";
import { overstayIntakeRouter } from "../../routes/overstayIntake";
import { businessIntakeRouter } from "../../routes/businessIntake";
// Runtime test import keeps the API TypeScript project's rootDir isolated.
const frontendHelperPath = new URL("../../../../../artifacts/emigration-assist/src/lib/finalize-assessment.ts", import.meta.url).pathname;
const confirmAssessmentCompletion = async (endpoint: string, fetcher: any) =>
  (await import(frontendHelperPath)).confirmAssessmentCompletion(endpoint, fetcher);

const leadId = "11111111-1111-4111-8111-111111111111";
function handler(router: any, path: string) {
  return router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods.post).route.stack[0].handle;
}
function response() {
  const res: any = { statusCode: 200 };
  res.status = (status: number) => { res.statusCode = status; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.setHeader = vi.fn();
  return res;
}
const req = (body: any = {}, id = leadId) => ({ body, params: { id }, ip: "synthetic-test", log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.finalize.mockResolvedValue(undefined);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DISABLE_OTP_VERIFICATION", "1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("actual route boundary regression without server, network, or application DB", () => {
  it("finalisation commit failure is not acknowledged and does not dispatch", async () => {
    mocks.rows = [[{ id: leadId, referenceNumber: "TEST-REFERENCE" }]];
    mocks.finalize.mockRejectedValueOnce(new Error("SYNTHETIC_DB_FAILURE"));
    const res = response();
    await expect(handler(individual, "/leads/:id/finalize")(req(), res)).rejects.toThrow("SYNTHETIC_DB_FAILURE");
    expect(res.body).toBeUndefined();
    expect(mocks.confirmation).not.toHaveBeenCalled();
  });
  it("durable finalisation runs before existing-notification short circuit", async () => {
    mocks.rows = [[{ id: leadId, referenceNumber: "TEST-REFERENCE" }], [{ id: "confirmation" }]];
    const res = response();
    await handler(individual, "/leads/:id/finalize")(req(), res);
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(res.body.finalized).toBe(true);
    expect(res.body.alreadyFinalized).toBe(true);
    expect(mocks.confirmation).not.toHaveBeenCalled();
  });
  it("invalid/missing leads do not generate snapshots or events", async () => {
    const invalid = response();
    await handler(individual, "/leads/:id/finalize")(req({}, "invalid"), invalid);
    expect(invalid.statusCode).toBe(400);
    const missing = response();
    await handler(individual, "/leads/:id/finalize")(req(), missing);
    expect(missing.statusCode).toBe(404);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
  const fixtures = [
    [individual, "/leads", {
      fullName: "Synthetic", email: "synthetic@example.invalid", nationality: "ZA", immigrationSituation: "unknown", consentAccepted: true, finalize: false,
    }],
    [overstayIntakeRouter, "/overstay-intake", {
      firstName: "Synthetic", email: "synthetic@example.invalid", currentSituation: "unsure_of_status",
      location: "inside_sa", overstayDuration: "unsure", submittedApplication: "no", dhaCommunication: "no",
      assistanceType: "general_guidance", preferredChannel: "email", consentAccepted: true,
    }],
    [businessIntakeRouter, "/business-intake", {
      firmName: "Synthetic Firm", countryHq: "ZA", headcountBand: "1-5", yearsOperating: 1,
      practiceAreas: ["appeals"], multiJurisBeyondZa: false, decisionMakerTech: true,
      painAnswers: { backlog: "test", documents: "test", compliance: "test", team: "test", clientExperience: "test" },
      casesLast12mBand: "<25", pctCrossBorder: 0, typicalDurationBand: "<1 month",
      fullName: "Synthetic", email: "synthetic@example.invalid", preferredChannel: "email", consentAccepted: true,
    }],
  ] as const;
  for (const [router, path, body] of fixtures) {
    if (path !== "/leads") {
    it(`${path} acknowledges only a committed completed snapshot`, async () => {
      mocks.save.mockResolvedValueOnce([{ id: leadId, referenceNumber: "SAVED-REFERENCE" }]);
      const res = response();
      await handler(router, path)(req(body), res);
      expect(mocks.save).toHaveBeenCalledOnce();
      expect(mocks.save.mock.calls[0][5]).toBe(true);
      expect(res.statusCode).toBe(201);
      expect(res.body).toMatchObject({ leadId, referenceNumber: "SAVED-REFERENCE" });
    });
    it(`${path} retains failure for retry and never acknowledges an uncommitted save`, async () => {
      mocks.save.mockRejectedValueOnce(new Error("SYNTHETIC_TRANSACTION_FAILURE"));
      const res = response();
      await handler(router, path)(req(body), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.leadId).toBeUndefined();
      expect(mocks.confirmation).not.toHaveBeenCalled();
      expect(mocks.event).not.toHaveBeenCalled();
      mocks.save.mockResolvedValueOnce([{ id: leadId, referenceNumber: "RETRY-REFERENCE" }]);
      const retried = response();
      await handler(router, path)(req(body), retried);
      expect(retried.statusCode).toBe(201);
    });
    }
    it(`${path} preserves duplicate 409/reference without saving or queuing`, async () => {
      mocks.rows = [[{ id: leadId, referenceNumber: "EXISTING-REFERENCE" }]];
      const res = response();
      await handler(router, path)(req(body), res);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe("already_registered");
      expect(res.body.referenceNumber).toBe("EXISTING-REFERENCE");
      expect(mocks.save).not.toHaveBeenCalled();
    });
    it(`${path} preserves validation before database/queue writes`, async () => {
      const res = response();
      await handler(router, path)(req({}), res);
      expect(res.statusCode).toBe(400);
      expect(mocks.save).not.toHaveBeenCalled();
    });
  }
});
describe("frontend finalisation contract", () => {
  it("reuses the attempt token for lost-response retries and refreshed OTP, but not changed answers", async () => {
    const { withSubmissionAttempt } = await import(frontendHelperPath);
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const first = await withSubmissionAttempt("test-flow", { email: "synthetic@example.invalid", verifiedOtpId: "proof-1" });
    const retry = await withSubmissionAttempt("test-flow", { email: "synthetic@example.invalid", verifiedOtpId: "proof-2" });
    const changed = await withSubmissionAttempt("test-flow", { email: "changed@example.invalid", verifiedOtpId: "proof-2" });
    expect(retry.submissionAttemptId).toBe(first.submissionAttemptId);
    expect(changed.submissionAttemptId).not.toBe(first.submissionAttemptId);
    expect([...values.values()].join("")).not.toContain("@example.invalid");
    expect([...values.values()].join("")).not.toContain("proof-");
  });
  it("all intake flows reject malformed/non-committed acknowledgments", async () => {
    const { confirmedIntake } = await import(frontendHelperPath);
    for (const body of [null, {}, { leadId, referenceNumber: "" },
      { leadId: "not-an-id", referenceNumber: "REF" },
      { leadId: "00000000-0000-0000-0000-000000000000", referenceNumber: "EMA-BUS-PENDING" }]) {
      expect(() => confirmedIntake(body)).toThrow("could not be confirmed");
    }
    expect(confirmedIntake({ leadId, referenceNumber: "CONFIRMED" }))
      .toEqual({ leadId, referenceNumber: "CONFIRMED" });
  });
  it.each([400, 500])("HTTP %i rejects instead of navigating to summary", async status => {
    const fetcher: any = vi.fn(async () => ({ ok: false, status }));
    await expect(confirmAssessmentCompletion("/synthetic/finalize", fetcher)).rejects.toThrow();
  });
  it("rejects network failure and non-confirming 200 then allows retry", async () => {
    const fetcher: any = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ finalized: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ finalized: true, alreadyFinalized: true }) });
    await expect(confirmAssessmentCompletion("/synthetic/finalize", fetcher)).rejects.toThrow("offline");
    await expect(confirmAssessmentCompletion("/synthetic/finalize", fetcher)).rejects.toThrow("not confirmed");
    await expect(confirmAssessmentCompletion("/synthetic/finalize", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});