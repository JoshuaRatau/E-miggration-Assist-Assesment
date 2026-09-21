import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpGhlClient, type HttpGhlClientOptions, type Method } from "./client";
import { startGhlDelivery } from "./runtime";
import { fieldDefinitions } from "./fields";
import { captureEnabled, captureConfig, deliveryConfig, protectedGhlFieldIds } from "./config";
import { GhlWorker } from "./worker";

const settings = (fetcher: typeof fetch, overrides: Partial<HttpGhlClientOptions> = {}): HttpGhlClientOptions => ({
  enabled: true, allowWrites: true, environment: "test", locationId: "test-location",
  approvedLocationId: "test-location", getToken: () => "synthetic-secret", fetch: fetcher, ...overrides,
});
const env = () => ({
  NODE_ENV: "test", EMA_GHL_DELIVERY_ENABLED: "true", GHL_LOCATION_ID: "test-location",
  EMA_GHL_APPROVED_TEST_LOCATION_ID: "test-location", EMA_GHL_DELIVERY_APPROVAL: "ALLOW_SYNTHETIC_TEST_DELIVERY",
  GHL_PRIVATE_INTEGRATION_TOKEN: "synthetic-secret", EMA_GHL_PIPELINE_ID: "pipeline", EMA_GHL_STAGE_ID: "stage",
  EMA_GHL_FIELD_IDS_JSON: JSON.stringify(Object.fromEntries(fieldDefinitions.map(f => [`${f.model}.${f.key}`, `${f.model}-${f.key}`]))),
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("network-capable client with intercepted transport only", () => {
  it.each([
    ["GET", "/locations/test-location/customFields?model=contact", undefined, { customFields: [{ id: "f", name: "EMA", dataType: "TEXT" }] }],
    ["POST", "/locations/test-location/customFields", { name: "EMA", dataType: "TEXT" }, { customField: { id: "f" } }],
    ["GET", "/contacts/search/duplicate?locationId=test-location&email=a%40example.invalid", undefined, { contact: null }],
    ["GET", "/contacts/c", undefined, { contact: { id: "c", customFields: [{ id: "f", value: "v" }] } }],
    ["POST", "/contacts/upsert", { locationId: "test-location" }, { contact: { id: "c" } }],
    ["PUT", "/contacts/c", { name: "Synthetic" }, { contact: { id: "c" } }],
    ["GET", "/contacts/c/notes", undefined, { notes: [{ id: "n", body: "Synthetic" }] }],
    ["GET", "/contacts/c/notes/n", undefined, { note: { id: "n", body: "Synthetic", contactId: "c" } }],
    ["POST", "/contacts/c/notes", { body: "Synthetic" }, { note: { id: "n", body: "Synthetic" } }],
    ["GET", "/opportunities/search?locationId=test-location", undefined, { opportunities: [{ id: "o", customFields: [{ id: "f", fieldValue: "v" }] }] }],
    ["GET", "/opportunities/o", undefined, { opportunity: { id: "o" } }],
    ["GET", "/opportunities/pipelines?locationId=test-location", undefined, { pipelines: [{ id: "p" }] }],
    ["POST", "/opportunities/", { locationId: "test-location" }, { opportunity: { id: "o" } }],
    ["PUT", "/opportunities/o", { name: "Synthetic" }, { opportunity: { id: "o" } }],
  ] as const)("validates %s %s and sends exact headers", async (method, path, body, payload) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new HttpGhlClient(settings(transport));
    expect((await client.request(method as Method, path, body)).body).toEqual(payload);
    const [url, request] = transport.mock.calls[0];
    expect(String(url)).toBe(`https://services.leadconnectorhq.com${path}`);
    expect(request).toMatchObject({ method, redirect: "error", headers: { Authorization: "Bearer synthetic-secret", Version: "v3" } });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    if (body) expect(JSON.parse(request?.body as string)).toEqual(body);
  });
  it("disabled client reads neither credentials nor network", async () => {
    const transport = vi.fn(), token = vi.fn();
    const client = new HttpGhlClient(settings(transport, { enabled: false, getToken: token }));
    await expect(client.request("GET", "/contacts/c")).rejects.toMatchObject({ code: "DELIVERY_DISABLED" });
    expect(token).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it("blocks writes, wrong destination and unsafe endpoints before network", async () => {
    const transport = vi.fn();
    await expect(new HttpGhlClient(settings(transport, { allowWrites: false })).request("PUT", "/contacts/c", {}))
      .rejects.toMatchObject({ code: "LIVE_GHL_WRITES_DISABLED" });
    for (const path of ["https://evil.invalid", "//evil.invalid/x", "/contacts/%2e%2e", "/unknown", "/locations/other/customFields"]) {
      await expect(new HttpGhlClient(settings(transport)).request("GET", path)).rejects.toBeDefined();
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 429, 500, 503])("redacts HTTP %s error bodies and parses retry-after", async status => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-person@example.invalid synthetic-secret", {
      status, headers: { "Retry-After": "12" },
    }));
    try { await new HttpGhlClient(settings(transport)).request("GET", "/contacts/c"); throw new Error("expected rejection"); }
    catch (e: any) {
      expect(e.status).toBe(status); expect(e.retryAfterMs).toBe(12000);
      expect(String(e)).not.toMatch(/private-person|synthetic-secret/);
    }
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("validates provider-specific custom-field shapes and malformed JSON", async () => {
    for (const payload of ["invalid", JSON.stringify({ contact: { id: "c", customFields: [{ id: "f", fieldValue: "wrong" }] } })]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(payload));
      await expect(new HttpGhlClient(settings(transport)).request("GET", "/contacts/c"))
        .rejects.toMatchObject({ code: "INVALID_REMOTE_RESPONSE" });
    }
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      opportunity: { id: "o", customFields: [{ id: "f", value: "wrong" }] },
    })));
    await expect(new HttpGhlClient(settings(transport)).request("GET", "/opportunities/o"))
      .rejects.toMatchObject({ code: "INVALID_REMOTE_RESPONSE" });
  });
  it("aborts timeout even when intercepted transport never resolves, no retry", async () => {
    let signal: AbortSignal | undefined;
    const transport = vi.fn<typeof fetch>((_, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}); });
    await expect(new HttpGhlClient(settings(transport, { timeoutMs: 5 })).request("PUT", "/contacts/c", {}))
      .rejects.toMatchObject({ code: "AMBIGUOUS_TRANSPORT" });
    expect(signal?.aborted).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("redacts thrown transport errors and parses date Retry-After", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret/person@example.invalid"));
    await expect(new HttpGhlClient(settings(transport)).request("GET", "/contacts/c"))
      .rejects.toMatchObject({ message: "AMBIGUOUS_TRANSPORT" });
    const dateTransport = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429,
      headers: { "Retry-After": new Date(Date.now() + 30000).toUTCString() } }));
    try { await new HttpGhlClient(settings(dateTransport)).request("GET", "/contacts/c"); }
    catch (e: any) { expect(e.retryAfterMs).toBeGreaterThan(28000); }
  });
});

describe("startup/shutdown and independent default-off gates", () => {
  it.each(["test", "development"])("uses identical capture/delivery scopes for %s", nodeEnv => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("EMA_GHL_TEST_LOCATION_ID", "test-location");
    const captured = captureConfig();
    const delivery = deliveryConfig({ ...env(), NODE_ENV: nodeEnv, EMA_GHL_TEST_LOCATION_ID: "test-location" });
    expect([captured.environment, captured.locationId]).toEqual([delivery.environment, delivery.locationId]);
  });
  it.each(protectedGhlFieldIds)("rejects protected field %s before credentials/DB/transport access", async id => {
    const e = env();
    const fields = JSON.parse(e.EMA_GHL_FIELD_IDS_JSON);
    fields["contact.ema_source"] = id;
    e.EMA_GHL_FIELD_IDS_JSON = JSON.stringify(fields);
    Object.defineProperty(e, "GHL_PRIVATE_INTEGRATION_TOKEN", { get() { throw new Error("credential access forbidden"); } });
    const loadDatabase = vi.fn(), transport = vi.fn();
    await expect(startGhlDelivery({ env: e, loadDatabase, fetch: transport }))
      .rejects.toMatchObject({ code: "PROTECTED_FIELD_MAPPING" });
    expect(loadDatabase).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
    expect(() => new GhlWorker({} as any, {} as any, {
      environment: "test", locationId: "test-location", fieldIds: fields,
    })).toThrow("PROTECTED_FIELD_MAPPING");
  });
  it("rejects duplicate IDs across contact/opportunity models before loading DB", async () => {
    const e = env(), fields = JSON.parse(e.EMA_GHL_FIELD_IDS_JSON);
    fields["opportunity.ema_lead_id"] = fields["contact.ema_lead_id"];
    e.EMA_GHL_FIELD_IDS_JSON = JSON.stringify(fields);
    const loadDatabase = vi.fn();
    await expect(startGhlDelivery({ env: e, loadDatabase })).rejects.toMatchObject({ code: "DUPLICATE_FIELD_MAPPING" });
    expect(loadDatabase).not.toHaveBeenCalled();
    expect(() => new GhlWorker({} as any, {} as any, {
      environment: "test", locationId: "test-location", fieldIds: fields,
    })).toThrow("DUPLICATE_FIELD_MAPPING");
  });
  it("revalidates injected configuration mutated after worker construction", async () => {
    const config = deliveryConfig(env());
    const execute = vi.fn();
    const worker = new GhlWorker({ execute } as any, {} as any, config);
    config.fieldIds["contact.ema_source"] = protectedGhlFieldIds[0];
    await expect(worker.tick()).rejects.toMatchObject({ code: "PROTECTED_FIELD_MAPPING" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("disabled runtime does not access credentials, import/query DB, construct worker or call transport", async () => {
    const loadDatabase = vi.fn(), makeWorker = vi.fn(), transport = vi.fn();
    const disabled = new Proxy({ EMA_GHL_DELIVERY_ENABLED: "false" }, { get(target, key) {
      if (key !== "EMA_GHL_DELIVERY_ENABLED") throw new Error("unexpected configuration read");
      return target.EMA_GHL_DELIVERY_ENABLED;
    } });
    const runtime = await startGhlDelivery({ env: disabled, loadDatabase, makeWorker, fetch: transport });
    expect(runtime.enabled).toBe(false); await runtime.stop();
    expect(loadDatabase).not.toHaveBeenCalled(); expect(makeWorker).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it("credentials alone cannot start delivery and capture stays independent", async () => {
    const e = { ...env(), EMA_GHL_DELIVERY_ENABLED: "false" };
    expect((await startGhlDelivery({ env: e })).enabled).toBe(false);
    vi.stubEnv("EMA_GHL_CAPTURE_ENABLED", "false");
    expect(captureEnabled()).toBe(false);
    expect(deliveryConfig(env()).environment).toBe("test");
  });
  it.each([
    { EMA_GHL_DELIVERY_APPROVAL: "" }, { EMA_GHL_APPROVED_TEST_LOCATION_ID: "other" },
    { NODE_ENV: "production" }, { EMA_GHL_TEST_LOCATION_ID: "other" }, { EMA_GHL_PIPELINE_ID: "" },
    { EMA_GHL_FIELD_IDS_JSON: "{}" }, { GHL_PRIVATE_INTEGRATION_TOKEN: "" },
  ])("fails closed before DB access for invalid settings %o", async patch => {
    const loadDatabase = vi.fn();
    await expect(startGhlDelivery({ env: { ...env(), ...patch }, loadDatabase })).rejects.toBeDefined();
    expect(loadDatabase).not.toHaveBeenCalled();
  });
  it("runs one tick at a time; stop waits in-flight and never reschedules", async () => {
    vi.useFakeTimers();
    let resolve!: (v: boolean) => void;
    const tick = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const runtime = await startGhlDelivery({ env: env(), loadDatabase: async () => ({} as any),
      makeWorker: () => ({ tick }), intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(100); expect(tick).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    resolve(true); await stop;
    await vi.advanceTimersByTimeAsync(100); expect(tick).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });
});