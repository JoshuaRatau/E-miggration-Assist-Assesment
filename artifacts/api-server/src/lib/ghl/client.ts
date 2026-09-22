import { GhlFailure, type ProviderCorrelation } from "./config";
export type Method = "GET" | "POST" | "PUT";
export type MockRequest = { method: Method; path: string; body?: Record<string, unknown>; version: "v3" };
export type MockResponse = {
  status: number;
  body: any;
  retryAfterMs?: number;
  headers?: Record<string, string | undefined>;
};
export interface GhlClient {
  request(method: Method, path: string, body?: Record<string, unknown>): Promise<MockResponse>;
}
export type HttpGhlClientOptions = {
  enabled: boolean;
  allowWrites: boolean;
  environment: "development" | "test" | "production";
  productionApproval?: "ALLOW_PRODUCTION_DELIVERY";
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

const REDACTED = "REDACTED";
const safeMessages = new Set([
  "Bad Request",
  "Validation Error",
  "Validation failed",
  "Duplicate Opportunity",
  "Duplicate opportunity",
  "Can not create duplicate opportunity for the contact.",
  "Cannot create duplicate opportunity",
  "Opportunity already exists",
]);
const duplicateOpportunityMessages = new Set([
  "Can not create duplicate opportunity for the contact.",
  "Cannot create duplicate opportunity",
  "Opportunity already exists",
]);
const safeValidationFields = new Set([
  "locationId", "contactId", "pipelineId", "pipelineStageId", "name", "status",
  "customFields", "monetaryValue", "assignedTo",
]);
const safeResponseKeys = new Set([
  "message", "status", "statusCode", "errors", "error", "details", "field", "path",
  "param", "parameter", "property", "traceId", "code", "type",
  ...safeValidationFields,
]);
const sensitiveKey = /(?:authorization|credential|token|secret|password|cookie|email|phone|mobile|name|value|address)/i;
const safeTraceId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) &&
  /[A-Za-z]/.test(value) && /\d/.test(value) && /[._:-]/.test(value);

/**
 * Preserve response shape, but never arbitrary provider strings/scalars.
 * Message text is exact-match allowlisted: interpolated variants are redacted.
 */
export function redactProviderFailureBody(input: unknown, depth = 0): Record<string, unknown> {
  const redactValue = (value: unknown, key: string, level: number): unknown => {
    if (sensitiveKey.test(key)) return REDACTED;
    if (key === "message") return typeof value === "string" && safeMessages.has(value) ? value : REDACTED;
    if (["field", "path", "param", "parameter", "property"].includes(key))
      return typeof value === "string" && safeValidationFields.has(value) ? value : REDACTED;
    if ((key === "status" || key === "statusCode") && Number.isInteger(value) &&
      Number(value) >= 100 && Number(value) <= 599) return value;
    if (key === "traceId") return safeTraceId(value) ? value : REDACTED;
    if (level >= 4) return REDACTED;
    if (Array.isArray(value)) return value.slice(0, 10).map(item =>
      object(item) ? redactObject(item, level + 1) : REDACTED);
    if (object(value)) return redactObject(value, level + 1);
    return REDACTED;
  };
  const redactObject = (value: Record<string, unknown>, level: number) =>
    Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, nested], index) => {
      const outputKey = safeResponseKeys.has(key) ? key : `REDACTED_KEY_${index + 1}`;
      return [outputKey, redactValue(nested, key, level)];
    }));
  return object(input) ? redactObject(input, depth) : { message: REDACTED };
}

function bodyTraceId(input: unknown, depth = 0): string | undefined {
  if (!object(input) || depth > 4) return;
  if (safeTraceId(input.traceId)) return input.traceId;
  for (const value of Object.values(input).slice(0, 30)) {
    if (object(value)) {
      const found = bodyTraceId(value, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function duplicateOpportunityClassification(input: unknown) {
  if (!object(input)) return;
  const messages: unknown[] = [];
  const collect = (value: unknown, depth = 0) => {
    if (!object(value) || depth > 4) return;
    if (Object.hasOwn(value, "message")) messages.push(value.message);
    for (const nested of Object.values(value).slice(0, 30)) if (object(nested)) collect(nested, depth + 1);
  };
  collect(input);
  return messages.some(message => typeof message === "string" && duplicateOpportunityMessages.has(message))
    ? {
      reason: "DUPLICATE_OPPORTUNITY" as const,
      source: "sanitizer:exact-message-allowlist" as const,
    }
    : undefined;
}

function providerCorrelation(
  headers: { get(name: string): string | null } | Record<string, string | undefined> | undefined,
  body: unknown,
): ProviderCorrelation | undefined {
  for (const name of ["x-request-id", "x-correlation-id"] as const) {
    const get = headers && (headers as { get?: unknown }).get;
    const value = typeof get === "function"
      ? (get as (name: string) => string | null).call(headers, name)
      : (headers as Record<string, string | undefined> | undefined)?.[name];
    if (safeTraceId(value)) return { id: value, source: `response-header:${name}` };
  }
  const id = bodyTraceId(body);
  return id ? { id, source: "body.traceId" } : undefined;
}

/** Search alone returns text definitions with type="string" and fieldValueString. Keep the worker's
 * canonical fieldValue representation without changing individual GET/create
 * contracts, coercing values, or accepting conflicting representations. */
function normalizeOpportunitySearch(data: any, status: number) {
  if (!object(data) || !Array.isArray(data.opportunities)) return;
  for (const opportunity of data.opportunities) {
    if (!object(opportunity) || !Array.isArray(opportunity.customFields)) continue;
    opportunity.customFields = opportunity.customFields.map((field: any) => {
      if (!object(field) || !Object.hasOwn(field, "fieldValueString")) return field;
      if (!entity(field) || field.type !== "string" || typeof field.fieldValueString !== "string" ||
        (Object.hasOwn(field, "fieldValue") && field.fieldValue !== field.fieldValueString) ||
        Object.keys(field).some(key => key === "value" || (key.startsWith("fieldValue") &&
          key !== "fieldValue" && key !== "fieldValueString")))
        throw new GhlFailure("INVALID_REMOTE_RESPONSE", status);
      return { ...field, fieldValue: field.fieldValueString };
    });
  }
}

/** Fixed-host, redirect-refusing transport. No internal retries of mutations. */
export class HttpGhlClient implements GhlClient {
  constructor(private options: HttpGhlClientOptions) {}
  async request(method: Method, path: string, body?: Record<string, unknown>): Promise<MockResponse> {
    const o = this.options;
    if (!o.enabled) throw new GhlFailure("DELIVERY_DISABLED");
    if (method !== "GET" && !o.allowWrites) throw new GhlFailure("LIVE_GHL_WRITES_DISABLED");
    if (o.environment === "production") {
      if (o.productionApproval !== "ALLOW_PRODUCTION_DELIVERY") throw new GhlFailure("PRODUCTION_DELIVERY_APPROVAL_REQUIRED");
    } else if (!["development", "test"].includes(o.environment)) throw new GhlFailure("TEST_ENVIRONMENT_REQUIRED");
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
    if (o.environment === "production" && method !== "GET" && (isFields || p === "/contacts/upsert"))
      throw new GhlFailure("PRODUCTION_SETUP_WRITE_DENIED");
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
            let responseBody: unknown;
            try {
              const text = await response.text();
              try { responseBody = JSON.parse(text); } catch { responseBody = text; }
            } catch { responseBody = undefined; }
            const classification = duplicateOpportunityClassification(responseBody);
            throw new GhlFailure(response.status === 408 ? "AMBIGUOUS_TRANSPORT" : response.status === 429 ? "RATE_LIMIT" :
              response.status >= 500 ? "REMOTE_UNAVAILABLE" : "REMOTE_REJECTED", response.status,
              delay !== undefined && Number.isFinite(delay) ? Math.max(0, delay) : undefined,
              redactProviderFailureBody(responseBody), providerCorrelation(response.headers, responseBody),
              classification?.reason, classification?.source);
          }
          let data: any;
          try { data = await response.json(); } catch { throw new GhlFailure("INVALID_REMOTE_RESPONSE", response.status); }
          if (method === "GET" && isSearch) normalizeOpportunitySearch(data, response.status);
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
      const classification = duplicateOpportunityClassification(response.body);
      throw new GhlFailure(response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "REMOTE_UNAVAILABLE" : "REMOTE_REJECTED",
        response.status, response.retryAfterMs, redactProviderFailureBody(response.body),
        providerCorrelation(response.headers, response.body), classification?.reason, classification?.source);
    }
    return response;
  }
}