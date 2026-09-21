import { describe, expect, it, vi } from "vitest";
import { fieldDefinitions } from "./fields";
// CLI scripts live outside the application's rootDir; test their actual module
// without pulling the CLI entrypoint into the server's TypeScript project.
const { runGhlSetup } = await import("../../../scripts/" + "ghl-setup");

const env = {
  NODE_ENV: "test", EMA_GHL_SETUP_ENABLED: "true",
  GHL_LOCATION_ID: "isolated-test", EMA_GHL_TEST_LOCATION_ID: "isolated-test",
  GHL_PRIVATE_INTEGRATION_TOKEN: "synthetic-test-token",
};
const args = ["--apply", "--location-id", "isolated-test", "--approve-location", "isolated-test"];
function field(index: number) {
  const d = fieldDefinitions[index];
  return { ...d, id: `field-${index}`, fieldKey: `${d.model}.${d.key}` };
}
function transport(existing: ReturnType<typeof field>[] = []) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === "GET") {
      const model = new URL(String(url)).searchParams.get("model");
      return Response.json({ customFields: existing.filter(f => f.model === model) });
    }
    const body = JSON.parse(String(init?.body));
    const index = fieldDefinitions.findIndex(f => f.name === body.name && f.model === body.model);
    return Response.json({ customField: field(index) });
  });
}
describe("GHL field setup: intercepted HTTP only", () => {
  it("defaults to dry run with 22 definitions, without environment or network access", async () => {
    const fetch = transport();
    const poison = new Proxy({}, { get() { throw new Error("environment accessed"); } });
    const result = await runGhlSetup([], { env: poison, fetch });
    expect(result.mode).toBe("dry-run");
    expect("definitions" in result && result.definitions?.length).toBe(22);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...env, EMA_GHL_SETUP_ENABLED: "false" },
    { ...env, GHL_LOCATION_ID: "different-location" },
    { ...env, EMA_GHL_TEST_LOCATION_ID: undefined },
    { ...env, GHL_PRIVATE_INTEGRATION_TOKEN: undefined },
    { ...env, NODE_ENV: "production" },
  ])("rejects unsafe environment before any HTTP", async unsafe => {
    const fetch = transport();
    await expect(runGhlSetup(args, { env: unsafe, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["--apply"],
    [...args, "--dry-run"],
    [...args.slice(0, -1), "wrong"],
    ["--execute"],
    [...args, "--reuse", "contact.ema_lead_id=2iOXERu2s46l8kMCBiHz"],
  ].map(unsafe => ({ unsafe })))("rejects unapproved arguments before HTTP", async ({ unsafe }) => {
    const fetch = transport();
    await expect(runGhlSetup(unsafe, { env, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preflights both models then creates only proposed fields with v3 and fixed destination", async () => {
    const fetch = transport();
    const onCreated = vi.fn();
    const result = await runGhlSetup(args, { env, fetch, onCreated });
    expect(result.mode).toBe("applied");
    expect(fetch).toHaveBeenCalledTimes(24);
    expect(onCreated).toHaveBeenCalledTimes(22);
    expect(fetch.mock.calls.slice(0, 2).every(([, init]) => init?.method === "GET")).toBe(true);
    for (const [url, init] of fetch.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/services\.leadconnectorhq\.com\/locations\/isolated-test\/customFields/);
      expect(init?.headers).toMatchObject({ Version: "v3", Authorization: "Bearer synthetic-test-token" });
      expect(init?.redirect).toBe("error");
    }
    expect(JSON.stringify(result)).not.toContain(env.GHL_PRIVATE_INTEGRATION_TOKEN);
  });
  it("blocks matching names/keys without explicit semantic reuse approval before any POST", async () => {
    const fetch = transport([field(0)]);
    await expect(runGhlSetup(args, { env, fetch })).rejects.toThrow("FIELD_COLLISION_REQUIRES_EXPLICIT_REUSE_APPROVAL");
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("reuses all compatible approved IDs without POST", async () => {
    const fields = fieldDefinitions.map((_, i) => field(i));
    const fetch = transport(fields);
    const approvals = fields.flatMap(f => ["--reuse", `${f.fieldKey}=${f.id}`]);
    const result = await runGhlSetup([...args, ...approvals], { env, fetch });
    expect(result.mode).toBe("applied");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("blocks incompatible approved option definitions during full preflight", async () => {
    const existing = { ...field(3), options: ["wrong"] };
    const fetch = transport([existing]);
    await expect(runGhlSetup([...args, "--reuse", `${existing.fieldKey}=${existing.id}`], { env, fetch }))
      .rejects.toThrow("REUSE_INCOMPATIBLE");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("ignores unrelated fields and never updates the eight existing fields", async () => {
    const protectedField = { ...field(0), id: "2iOXERu2s46l8kMCBiHz", fieldKey: "contact.work_email", name: "Work Email" };
    const fetch = transport([protectedField]);
    await runGhlSetup(args, { env, fetch });
    expect(fetch.mock.calls.every(([, init]) => ["GET", "POST"].includes(String(init?.method)))).toBe(true);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")
      .every(([, init]) => !String(init?.body).includes("Work Email"))).toBe(true);
  });
  it("does not log remote response bodies or thrown credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("synthetic-test-token private data"));
    await expect(runGhlSetup(args, { env, fetch })).rejects.toThrow(/^READ_NETWORK_FAILURE$/);
    const rejected = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("private data", { status: 401 }));
    await expect(runGhlSetup(args, { env, fetch: rejected })).rejects.toThrow(/^GHL_HTTP_401$/);
  });
  it("aborts timed-out calls with safe errors and never retries writes", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    await expect(runGhlSetup(args, { env, fetch, timeoutMs: 5 })).rejects.toThrow("READ_TIMEOUT");
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("stops on malformed preflight or create responses without blindly retrying", async () => {
    const malformed = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ customFields: "bad" }));
    await expect(runGhlSetup(args, { env, fetch: malformed })).rejects.toThrow("INVALID_FIELDS_RESPONSE");
    const fetch = transport();
    fetch.mockImplementationOnce(async () => Response.json({ customFields: [] }));
    fetch.mockImplementationOnce(async () => Response.json({ customFields: [] }));
    fetch.mockImplementationOnce(async () => Response.json({ customField: { id: "unknown" } }));
    await expect(runGhlSetup(args, { env, fetch })).rejects.toThrow("INVALID_FIELD_RESPONSE");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});