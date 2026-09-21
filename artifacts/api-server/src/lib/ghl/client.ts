import { GhlFailure } from "./config";
export type Method = "GET" | "POST" | "PUT";
export type MockRequest = { method: Method; path: string; body?: Record<string, unknown>; version: "v3" };
export type MockResponse = { status: number; body: any; retryAfterMs?: number };
export interface GhlClient {
  request(method: Method, path: string, body?: Record<string, unknown>): Promise<MockResponse>;
}
export type HttpGhlClientOptions = {
  enabled: boolean;
  allowWrites: boolean;
  environment: "development" | "test";
  locationId: string;
  approvedLocationId: string;
  getToken: () => string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
};
const object = (v: any): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const entity = (v: any) => object(v) && typeof v.id === "string" && v.id.length > 0;
const customFields = (v: any, key: string) => v === undefined || (Array.isArray(v) &&
  v.every(f => entity(f) && Object.hasOwn(f, key)));

/** Fixed-host, redirect-refusing transport. No internal retries of mutations. */
export class HttpGhlClient implements GhlClient {
  constructor(private options: HttpGhlClientOptions) {}
  async request(method: Method, path: string, body?: Record<string, unknown>): Promise<MockResponse> {
    const o = this.options;
    if (!o.enabled) throw new GhlFailure("DELIVERY_DISABLED");
    if (method !== "GET" && !o.allowWrites) throw new GhlFailure("LIVE_GHL_WRITES_DISABLED");
    if (!["development", "test"].includes(o.environment)) throw new GhlFailure("TEST_ENVIRONMENT_REQUIRED");
    if (!o.locationId || o.approvedLocationId !== o.locationId) throw new GhlFailure("APPROVED_TEST_LOCATION_REQUIRED");
    if (!path.startsWith("/") || path.startsWith("//") || /[\\#\r\n]/.test(path) || /(^|\/)\.\.?($|\/|\?)/.test(path) ||
      /%2f|%5c|%2e/i.test(path)) throw new GhlFailure("INVALID_ENDPOINT");
    const url = new URL(path, "https://services.leadconnectorhq.com");
    const p = url.pathname;
    const isFields = /^\/locations\/[A-Za-z0-9_-]+\/customFields$/.test(p);
    const isDuplicate = p === "/contacts/search/duplicate";
    const isContact = /^\/contacts\/[A-Za-z0-9_-]+$/.test(p) && !p.endsWith("/upsert");
    const isNotes = /^\/contacts\/[A-Za-z0-9_-]+\/notes$/.test(p);
    const isNote = /^\/contacts\/[A-Za-z0-9_-]+\/notes\/[A-Za-z0-9_-]+$/.test(p);
    const isSearch = p === "/opportunities/search";
    const isPipelines = p === "/opportunities/pipelines";
    const isOpportunity = /^\/opportunities\/[A-Za-z0-9_-]+$/.test(p) && !isSearch && !isPipelines;
    const allowed = method === "GET" ? isFields || isDuplicate || isContact || isNotes || isNote || isSearch || isPipelines || isOpportunity :
      method === "POST" ? isFields || p === "/contacts/upsert" || p === "/contacts/" || isNotes || p === "/opportunities/" :
      method === "PUT" && (isContact || isOpportunity);
    if (!allowed || url.origin !== "https://services.leadconnectorhq.com") throw new GhlFailure("INVALID_ENDPOINT");
    if ((isFields && p.split("/")[2] !== o.locationId) ||
      ((isDuplicate || isSearch || isPipelines) && url.searchParams.get("locationId") !== o.locationId) ||
      (body?.locationId !== undefined && body.locationId !== o.locationId))
      throw new GhlFailure("DESTINATION_MISMATCH");
    if ((p === "/contacts/upsert" || p === "/contacts/" || p === "/opportunities/") && body?.locationId !== o.locationId)
      throw new GhlFailure("DESTINATION_MISMATCH");
    const token = o.getToken();
    if (!token) throw new GhlFailure("TOKEN_REQUIRED");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await (o.fetch ?? globalThis.fetch)(url.toString(), {
            method, redirect: "error", signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json",
              ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          if (!response.ok) {
            const raw = response.headers.get("retry-after");
            const delay = raw ? (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : undefined;
            throw new GhlFailure(response.status === 408 ? "AMBIGUOUS_TRANSPORT" : response.status === 429 ? "RATE_LIMIT" :
              response.status >= 500 ? "REMOTE_UNAVAILABLE" : "REMOTE_REJECTED", response.status,
              delay !== undefined && Number.isFinite(delay) ? Math.max(0, delay) : undefined);
          }
          let data: any;
          try { data = await response.json(); } catch { throw new GhlFailure("INVALID_REMOTE_RESPONSE", response.status); }
          const contactValid = (v: any) => entity(v) && customFields(v.customFields, "value");
          const opportunityValid = (v: any) => entity(v) && customFields(v.customFields, "fieldValue");
          const noteValid = (v: any) => entity(v) && typeof v.body === "string";
          const valid = object(data) && (
            isFields ? method === "GET" ? Array.isArray(data.customFields) && data.customFields.every(f => entity(f) && typeof f.name === "string" && typeof f.dataType === "string") : entity(data.customField) :
            isDuplicate ? Object.hasOwn(data, "contact") && (data.contact === null || contactValid(data.contact)) :
            isContact || p === "/contacts/upsert" || p === "/contacts/" ? contactValid(data.contact) :
            isNotes && method === "GET" ? Array.isArray(data.notes) && data.notes.every(noteValid) :
            isNotes || isNote ? noteValid(data.note) :
            isSearch ? Array.isArray(data.opportunities) && data.opportunities.every(opportunityValid) :
            isPipelines ? Array.isArray(data.pipelines) && data.pipelines.every(entity) :
            opportunityValid(data.opportunity));
          if (!valid) throw new GhlFailure("INVALID_REMOTE_RESPONSE", response.status);
          return { status: response.status, body: data };
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new GhlFailure("AMBIGUOUS_TRANSPORT"));
        }, o.timeoutMs ?? 10_000); }),
      ]);
    } catch (error) {
      if (error instanceof GhlFailure) throw error;
      throw new GhlFailure("AMBIGUOUS_TRANSPORT");
    } finally { if (timer) clearTimeout(timer); }
  }
}
// The ONLY constructible client accepts an in-process mock handler, not a URL,
// credential, fetch implementation, or environment-driven transport.
export class MockGhlClient {
  readonly mode = "mock-only" as const;
  constructor(private handler: (request: MockRequest) => Promise<MockResponse>, private timeoutMs = 10_000) {}
  async request(method: Method, path: string, body?: Record<string, unknown>) {
    let response: MockResponse;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { response = await Promise.race([
      this.handler({ method, path, body, version: "v3" }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new GhlFailure("AMBIGUOUS_TRANSPORT")), this.timeoutMs); }),
    ]); }
    catch (e) {
      if (e instanceof GhlFailure) throw e;
      throw new GhlFailure("AMBIGUOUS_TRANSPORT");
    }
    finally { if (timer) clearTimeout(timer); }
    if (response.status < 200 || response.status >= 300) {
      throw new GhlFailure(response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "REMOTE_UNAVAILABLE" : "REMOTE_REJECTED",
        response.status, response.retryAfterMs);
    }
    return response;
  }
}