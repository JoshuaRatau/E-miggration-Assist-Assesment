import { GhlFailure } from "./config";
export type Method = "GET" | "POST" | "PUT";
export type MockRequest = { method: Method; path: string; body?: Record<string, unknown>; version: "v3" };
export type MockResponse = { status: number; body: any; retryAfterMs?: number };
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