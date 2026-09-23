import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({ logger: { warn: vi.fn() } }));

const endpoint = "https://support-api.eridetech.africa";
const submission = {
  category: "technical_issue",
  message: "Mock support message",
  name: "Test",
  email: "test@example.invalid",
  pagePath: "/assessment",
};
const products = [{ id: "migrated-ema-product", productCode: "EMA" }];

describe("migrated Support Hub routing (mock HTTP only)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SUPPORT_HUB_URL", "");
    vi.stubEnv("SUPPORT_HUB_PRODUCT_ID", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the production API and its EMA ID, preserving the ticket contract", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(products))
      .mockResolvedValueOnce(Response.json({ ticketReference: "EMA-SUP-MOCK" }));
    vi.stubGlobal("fetch", fetchMock);
    const { forwardSupportTicketToHub } = await import("./supportHub");
    expect(await forwardSupportTicketToHub(submission)).toEqual({
      ok: true, ticketReference: "EMA-SUP-MOCK",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${endpoint}/api/support/products`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${endpoint}/api/support/tickets`);
    const request = fetchMock.mock.calls[1][1];
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toMatchObject({
      productId: "migrated-ema-product",
      category: "technical_bug",
      reporterEmail: submission.email,
      whatWentWrong: submission.message,
    });
  });

  it.each([
    ["unavailable", () => Response.json({}, { status: 503 })],
    ["missing EMA", () => Response.json([])],
    ["ambiguous EMA", () => Response.json([...products, ...products])],
    ["invalid ID", () => Response.json([{ id: 123, productCode: "EMA" }])],
  ])("does not POST or use a legacy ID when registry is %s", async (_label, response) => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const { forwardSupportTicketToHub } = await import("./supportHub");
    expect(await forwardSupportTicketToHub(submission)).toEqual({
      ok: false, reason: "hub_product_unresolved",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries registry resolution on a later request after a lookup failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Mock timeout"))
      .mockResolvedValueOnce(Response.json(products))
      .mockResolvedValueOnce(Response.json({ ticketNumber: "EMA-SUP-MOCK" }));
    vi.stubGlobal("fetch", fetchMock);
    const { forwardSupportTicketToHub } = await import("./supportHub");
    expect((await forwardSupportTicketToHub(submission)).ok).toBe(false);
    expect((await forwardSupportTicketToHub(submission)).ok).toBe(true);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `${endpoint}/api/support/products`,
      `${endpoint}/api/support/products`,
      `${endpoint}/api/support/tickets`,
    ]);
  });

  it("preserves explicit URL and product configuration", async () => {
    vi.stubEnv("SUPPORT_HUB_URL", "https://support.example.invalid///");
    vi.stubEnv("SUPPORT_HUB_PRODUCT_ID", "configured-product");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ticketReference: "MOCK" }));
    vi.stubGlobal("fetch", fetchMock);
    const { forwardSupportTicketToHub } = await import("./supportHub");
    await forwardSupportTicketToHub(submission);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://support.example.invalid/api/support/tickets");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).productId).toBe("configured-product");
  });
});