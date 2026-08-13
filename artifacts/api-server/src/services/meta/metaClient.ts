import { logger } from "../../lib/logger";
import { graphBase } from "./metaConfig";

// Central Meta Graph API client. ALL Graph calls go through here so
// versioning, pagination, rate-limit handling, retries and logging live
// in one place. Never log access tokens.

export type GraphErrorKind =
  | "rate_limited"
  | "token_expired"
  | "permission_missing"
  | "not_found"
  | "api_error"
  | "network_error";

export class GraphError extends Error {
  kind: GraphErrorKind;
  code: number | undefined;
  subcode: number | undefined;
  constructor(kind: GraphErrorKind, message: string, code?: number, subcode?: number) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.subcode = subcode;
  }
}

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

function classify(code: number | undefined, subcode: number | undefined, httpStatus: number): GraphErrorKind {
  // https://developers.facebook.com/docs/graph-api/guides/error-handling
  if (code === 4 || code === 17 || code === 32 || code === 613 || httpStatus === 429)
    return "rate_limited";
  if (code === 190) return "token_expired";
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code <= 299))
    return "permission_missing";
  if (httpStatus === 404 || code === 803) return "not_found";
  return "api_error";
}

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET a Graph API path with query params. `accessToken` is appended
 * server-side and never appears in logs. Retries transient failures
 * (network / rate limit) with backoff.
 */
export async function graphGet<T = Record<string, unknown>>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(
    path.startsWith("https://") ? path : `${graphBase()}/${path.replace(/^\//, "")}`,
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (accessToken && !url.searchParams.has("access_token"))
    url.searchParams.set("access_token", accessToken);

  let lastErr: GraphError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      lastErr = new GraphError(
        "network_error",
        err instanceof Error ? err.message : "fetch failed",
      );
      continue;
    }
    if (res.ok) {
      return (await res.json()) as T;
    }
    let body: GraphErrorBody = {};
    try {
      body = (await res.json()) as GraphErrorBody;
    } catch {
      /* non-JSON error body */
    }
    const kind = classify(body.error?.code, body.error?.error_subcode, res.status);
    const gerr = new GraphError(
      kind,
      body.error?.message ?? `Graph API HTTP ${res.status}`,
      body.error?.code,
      body.error?.error_subcode,
    );
    // Log without the URL query string (it contains the token).
    logger.warn(
      { path: url.pathname, kind, code: gerr.code, subcode: gerr.subcode },
      "Meta Graph API error",
    );
    if (kind === "rate_limited" || kind === "network_error") {
      lastErr = gerr;
      continue; // retry
    }
    throw gerr;
  }
  throw lastErr ?? new GraphError("api_error", "Graph request failed");
}

/**
 * Fetch ALL pages of a paginated edge, following `paging.next` cursors
 * until exhausted or `maxItems` reached (safety valve — Meta edges can
 * be effectively unbounded).
 */
export async function graphGetAll<Item = Record<string, unknown>>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  maxItems = 2000,
): Promise<Item[]> {
  const out: Item[] = [];
  type Page = { data?: Item[]; paging?: { next?: string } };
  let page = await graphGet<Page>(path, accessToken, {
    limit: "100",
    ...params,
  });
  for (;;) {
    if (Array.isArray(page.data)) out.push(...page.data);
    if (out.length >= maxItems) {
      logger.warn({ path, maxItems }, "Meta pagination hit safety limit");
      return out.slice(0, maxItems);
    }
    const next = page.paging?.next;
    if (!next) return out;
    page = await graphGet<Page>(next, accessToken);
  }
}
