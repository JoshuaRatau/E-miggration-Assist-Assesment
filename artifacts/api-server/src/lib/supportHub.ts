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

// E-Migration Assist product id in the hub's product registry. Override via
// env if the hub re-seeds with a different id.
const HUB_PRODUCT_ID =
  process.env.SUPPORT_HUB_PRODUCT_ID?.trim() ||
  "6e23325e-6d20-40ea-ade3-ced64862ed17";

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

  const summary = args.message.replace(/\s+/g, " ").trim().slice(0, 140);
  const payload = {
    productId: HUB_PRODUCT_ID,
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
