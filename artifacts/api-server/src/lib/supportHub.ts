import { logger } from "./logger";

/**
 * Eride Support Hub integration.
 *
 * Mirrors a Support Centre widget submission to the shared Eride Support Hub
 * (https://eride-support-hub.replit.app) so it surfaces as a ticket in the
 * cross-product triage wallboard at /admin/support/tickets and is assigned a
 * canonical reference (e.g. "EMA-SUP-2026-000012").
 *
 * The hub's public intake endpoint (POST /api/support/tickets) is
 * unauthenticated and validates a structured payload. It is intentionally
 * richer than our 4-field widget, so we map our fields onto it and synthesise
 * sensible values for the rest.
 */

const HUB_URL = (
  process.env.SUPPORT_HUB_URL?.trim() || "https://eride-support-hub.replit.app"
).replace(/\/+$/, "");

// E-Migration Assist product code in the hub's registry. The hub assigns the
// authoritative UUID; we resolve it by code so a re-seed can't break us.
const HUB_PRODUCT_CODE = "EMA";

// Last-resort product id if the dynamic lookup and env override both fail.
const HUB_PRODUCT_ID_FALLBACK =
  process.env.SUPPORT_HUB_PRODUCT_ID?.trim() ||
  "6e23325e-6d20-40ea-ade3-ced64862ed17";

// Resolved product id is cached for the process lifetime once a dynamic lookup
// succeeds (the registry id is stable). Fallbacks are never cached so a later
// submission can retry the lookup.
let cachedProductId: string | null = null;

/**
 * Resolve the EMA product id from the hub's public product registry at submit
 * time (per the integration contract — no hard-coding). Order of precedence:
 *   1. SUPPORT_HUB_PRODUCT_ID env override (operator escape hatch)
 *   2. cached value from a prior successful lookup
 *   3. live GET /api/support/products, matched on productCode === "EMA"
 *   4. hardcoded fallback UUID
 */
async function resolveProductId(): Promise<string> {
  const override = process.env.SUPPORT_HUB_PRODUCT_ID?.trim();
  if (override) return override;
  if (cachedProductId) return cachedProductId;

  try {
    const res = await fetch(`${HUB_URL}/api/support/products`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const products = (await res.json().catch(() => null)) as
        | Array<{ id?: string; productCode?: string }>
        | null;
      const match = Array.isArray(products)
        ? products.find((p) => p?.productCode === HUB_PRODUCT_CODE)
        : null;
      if (match?.id) {
        cachedProductId = match.id;
        return match.id;
      }
      logger.warn("Eride hub product registry has no EMA product; using fallback id");
    } else {
      logger.warn(
        { status: res.status },
        "Eride hub product lookup failed; using fallback id",
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Eride hub product lookup threw; using fallback id",
    );
  }

  return HUB_PRODUCT_ID_FALLBACK;
}

// Our widget categories → the hub's category enum. The hub has no catch-all
// "other" category (that value is a reporterType, not a category), so an
// unmapped value falls back to "general_support" — always valid per product.
const CATEGORY_MAP: Record<string, string> = {
  support_query: "general_support",
  general_question: "general_support",
  technical_issue: "technical_bug",
  payment_account: "payment_issue",
};

export type HubForwardResult =
  | { ok: true; ticketReference: string }
  | { ok: false; reason: string };

export async function forwardSupportTicketToHub(args: {
  category: string;
  message: string;
  name: string | null;
  email: string | null;
  pagePath: string | null;
}): Promise<HubForwardResult> {
  // The hub requires at least one reachable contact (email or WhatsApp). Our
  // widget only collects an optional email, so without it we cannot create a
  // hub ticket — the local row + team email still capture the request.
  if (!args.email) {
    return { ok: false, reason: "no_contact_email" };
  }

  const productId = await resolveProductId();
  const summary = args.message.replace(/\s+/g, " ").trim().slice(0, 140);
  const payload = {
    productId,
    category: CATEGORY_MAP[args.category] ?? "general_support",
    issueSummary: summary.length > 0 ? summary : "Support Centre request",
    whatWereYouTryingToDo:
      "Contacting support via the E-Migration Assist Support Centre widget.",
    whatWentWrong: args.message.trim(),
    pageOrStep: args.pagePath?.trim() || null,
    stepsToReproduce: null,
    applicationReference: null,
    reporterName: args.name?.trim() || "Support Centre user",
    reporterType: "applicant",
    reporterEmail: args.email,
    reporterWhatsapp: null,
    deviceType: null,
    browser: null,
    canContact: true,
    consent: true,
    deviceInfo: {
      ua: "",
      os: "",
      viewport: "",
      language: "",
      referrerPath: "",
      hrefPath: args.pagePath?.trim() || "",
    },
  };

  let res: Response;
  try {
    res = await fetch(`${HUB_URL}/api/support/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch_failed",
    };
  }

  if (!res.ok) {
    return { ok: false, reason: `hub_http_${res.status}` };
  }

  const data = (await res.json().catch(() => null)) as {
    ticketReference?: string;
    ticketNumber?: string;
  } | null;
  const ticketReference = data?.ticketReference ?? data?.ticketNumber;
  if (!ticketReference) {
    logger.warn("Hub accepted ticket but returned no reference");
    return { ok: false, reason: "missing_reference" };
  }

  return { ok: true, ticketReference };
}
