import {
  db,
  metaAdSetsTable,
  metaAdsTable,
  metaCampaignsTable,
  metaConnectionsTable,
  metaContentInsightsTable,
  metaInsightsDailyTable,
  metaLeadFormsTable,
  type MetaConnection,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import {
  createOauthState,
  decryptToken,
  encryptToken,
  graphBase,
  metaAppId,
  metaAppSecret,
  redirectUri,
} from "./metaConfig";
import { graphDelete, graphGet, graphGetAll, graphPost } from "./metaClient";

// Meta OAuth + connection lifecycle. Single-tenant: at most one ACTIVE
// connection row; connecting again replaces it.

export const OAUTH_SCOPES = [
  // Page + IG reporting
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  // Marketing / campaign reporting
  "ads_read",
  // Lead Ads
  "leads_retrieval",
  "pages_manage_ads",
  // Messaging metrics (page-level conversations)
  "pages_messaging",
  "business_management",
].join(",");

export function buildAuthUrl(): string {
  const appId = metaAppId();
  const redirect = redirectUri();
  if (!appId || !redirect)
    throw new Error("Meta app not configured (META_APP_ID / redirect URI)");
  const url = new URL(`https://www.facebook.com/${graphBase().split("/").pop()}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", createOauthState());
  // "Facebook Login for Business" apps use a pre-built configuration
  // (config_id) instead of a raw scope list. If one is provided via env,
  // prefer it — otherwise fall back to classic scopes.
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
  if (configId) {
    url.searchParams.set("config_id", configId);
  } else {
    url.searchParams.set("scope", OAUTH_SCOPES);
  }
  url.searchParams.set("response_type", "code");
  return url.toString();
}

type TokenResponse = { access_token?: string; expires_in?: number };

/** Exchange the OAuth code for a LONG-LIVED user token (~60 days). */
export async function exchangeCodeForLongLivedToken(code: string): Promise<{
  token: string;
  expiresAt: Date | null;
}> {
  const appId = metaAppId();
  const secret = metaAppSecret();
  const redirect = redirectUri();
  if (!appId || !secret || !redirect) throw new Error("Meta app not configured");

  // Step 1: code → short-lived token.
  const short = await graphGet<TokenResponse>("oauth/access_token", "", {
    client_id: appId,
    client_secret: secret,
    redirect_uri: redirect,
    code,
  });
  if (!short.access_token) throw new Error("Meta OAuth: no access token returned");

  // Step 2: short-lived → long-lived.
  const long = await graphGet<TokenResponse>("oauth/access_token", "", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: secret,
    fb_exchange_token: short.access_token,
  });
  const token = long.access_token ?? short.access_token;
  const expiresAt = long.expires_in
    ? new Date(Date.now() + long.expires_in * 1000)
    : null;
  return { token, expiresAt };
}

type PageItem = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
};

type AdAccountItem = { id: string; name?: string; account_status?: number };

/**
 * Choose which Page a fresh connection defaults to. Prefers the Page named
 * by META_DEFAULT_PAGE_NAME (case-insensitive substring, default
 * "e-migration assist"), falling back to the first Page. Prevents a
 * multi-Page Facebook user from landing on an unrelated business.
 */
export function pickDefaultPage(pages: PageItem[]): PageItem | null {
  const preferred = (process.env.META_DEFAULT_PAGE_NAME ?? "e-migration assist")
    .trim()
    .toLowerCase();
  if (preferred) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const target = norm(preferred);
    const match = pages.find((p) => p.name && norm(p.name).includes(target));
    if (match) return match;
  }
  return pages[0] ?? null;
}

/**
 * Complete the connection: discover the first Page (+ its IG business
 * account and page token) and the first active ad account, then upsert
 * the single connection row with encrypted tokens.
 */
export async function completeConnection(args: {
  userToken: string;
  tokenExpiresAt: Date | null;
  connectedByUserId: string | null;
}): Promise<MetaConnection> {
  const me = await graphGet<{ id: string }>("me", args.userToken, {
    fields: "id",
  });

  const pages = await graphGetAll<PageItem>("me/accounts", args.userToken, {
    fields: "id,name,access_token,instagram_business_account{id,username}",
  });
  const page = pickDefaultPage(pages);

  let adAccount: AdAccountItem | null = null;
  try {
    const accounts = await graphGetAll<AdAccountItem>(
      "me/adaccounts",
      args.userToken,
      { fields: "id,name,account_status" },
      50,
    );
    adAccount = accounts.find((a) => a.account_status === 1) ?? accounts[0] ?? null;
  } catch (err) {
    // ads_read may be un-granted — connection still valid for page/IG.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Meta connect: ad accounts unavailable",
    );
  }

  const values = {
    metaUserId: me.id,
    facebookPageId: page?.id ?? null,
    facebookPageName: page?.name ?? null,
    instagramAccountId: page?.instagram_business_account?.id ?? null,
    instagramUsername: page?.instagram_business_account?.username ?? null,
    userTokenEncrypted: encryptToken(args.userToken),
    pageTokenEncrypted: page?.access_token ? encryptToken(page.access_token) : null,
    tokenExpiresAt: args.tokenExpiresAt,
    adAccountId: adAccount?.id ?? null,
    adAccountName: adAccount?.name ?? null,
    // "unverified" until the first sync confirms real data can be pulled.
    // runFullSync advances this to "active" on first anyProgress=true run.
    status: "unverified",
    lastError: null,
    connectedByUserId: args.connectedByUserId,
    updatedAt: new Date(),
  };

  // Subscribe the Page to the app's leadgen webhook so Meta pushes lead
  // form submissions instantly (otherwise leads only arrive on the
  // 45-minute sync). Non-fatal: the connection is still valid without it.
  if (page?.id && page.access_token) {
    try {
      const sub = await subscribePageToLeadgen({
        pageId: page.id,
        pageAccessToken: page.access_token,
      });
      logger.info(
        { pageId: page.id, success: sub.success },
        "Meta connect: page subscribed to leadgen webhook",
      );
    } catch (err) {
      logger.warn(
        { pageId: page.id, err: err instanceof Error ? err.message : String(err) },
        "Meta connect: page leadgen webhook subscription failed",
      );
    }
  }

  const existing = await getConnection();
  if (existing) {
    const [row] = await db
      .update(metaConnectionsTable)
      .set(values)
      .where(eq(metaConnectionsTable.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db.insert(metaConnectionsTable).values(values).returning();
  return row!;
}

/**
 * List all Pages the connected user manages (id, name, IG link). Used by
 * the admin UI so the right business Page can be selected when the user
 * manages more than one.
 */
export async function listAvailablePages(conn: MetaConnection): Promise<
  { id: string; name: string | null; instagramUsername: string | null }[]
> {
  const token = userToken(conn);
  if (!token) throw new Error("No user token on connection");
  const pages = await graphGetAll<PageItem>("me/accounts", token, {
    fields: "id,name,instagram_business_account{id,username}",
  });
  return pages.map((p) => ({
    id: p.id,
    name: p.name ?? null,
    instagramUsername: p.instagram_business_account?.username ?? null,
  }));
}

/**
 * Switch the connection to a different Page (by id) without redoing OAuth.
 * Re-derives the page token + IG account from me/accounts and re-subscribes
 * the new Page to the leadgen webhook.
 */
export async function selectPage(conn: MetaConnection, pageId: string): Promise<MetaConnection> {
  const token = userToken(conn);
  if (!token) throw new Error("No user token on connection");
  const pages = await graphGetAll<PageItem>("me/accounts", token, {
    fields: "id,name,access_token,instagram_business_account{id,username}",
  });
  const page = pages.find((p) => p.id === pageId);
  if (!page) throw new Error("Page not found among the accounts this connection can access");

  // Unsubscribe the OLD page from the leadgen webhook so its lead events
  // stop arriving (best-effort — the old token may already be invalid).
  if (conn.facebookPageId && conn.facebookPageId !== page.id && conn.pageTokenEncrypted) {
    try {
      await graphDelete(`${conn.facebookPageId}/subscribed_apps`, decryptToken(conn.pageTokenEncrypted));
      logger.info({ pageId: conn.facebookPageId }, "Meta select-page: old page unsubscribed from leadgen webhook");
    } catch (err) {
      logger.warn(
        { pageId: conn.facebookPageId, err: err instanceof Error ? err.message : String(err) },
        "Meta select-page: old page unsubscribe failed (non-fatal)",
      );
    }
  }

  if (page.access_token) {
    try {
      const sub = await subscribePageToLeadgen({ pageId: page.id, pageAccessToken: page.access_token });
      logger.info({ pageId: page.id, success: sub.success }, "Meta select-page: leadgen webhook subscription");
    } catch (err) {
      logger.warn(
        { pageId: page.id, err: err instanceof Error ? err.message : String(err) },
        "Meta select-page: leadgen webhook subscription failed",
      );
    }
  }

  // Purge cached analytics from the previous Page so old and new data are
  // never mixed on the dashboard. (Imported leads in the CRM are kept —
  // they are business records, not analytics cache.)
  if (conn.facebookPageId !== page.id) {
    await db.transaction(async (tx) => {
      await tx.delete(metaInsightsDailyTable);
      await tx.delete(metaContentInsightsTable);
      await tx.delete(metaAdsTable);
      await tx.delete(metaAdSetsTable);
      await tx.delete(metaCampaignsTable);
      await tx.delete(metaLeadFormsTable);
    });
    logger.info(
      { from: conn.facebookPageId, to: page.id },
      "Meta select-page: purged cached analytics from previous Page",
    );
  }

  const [row] = await db
    .update(metaConnectionsTable)
    .set({
      facebookPageId: page.id,
      facebookPageName: page.name ?? null,
      instagramAccountId: page.instagram_business_account?.id ?? null,
      instagramUsername: page.instagram_business_account?.username ?? null,
      pageTokenEncrypted: page.access_token ? encryptToken(page.access_token) : null,
      // Data must be re-verified against the new Page; the dashboard shows
      // the "initial sync" state until the new Page's sync completes.
      status: "unverified",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(metaConnectionsTable.id, conn.id))
    .returning();
  return row!;
}

/**
 * Subscribe the connected Page to the app's webhooks with the `leadgen`
 * field. Without this, Meta never pushes lead form submissions to the
 * webhook — leads only arrive on the 45-minute sync. Requires a page
 * token (pages_manage_ads grants the subscribed_apps edge).
 */
export async function subscribePageToLeadgen(args: {
  pageId: string;
  pageAccessToken: string;
}): Promise<{ success: boolean }> {
  const res = await graphPost<{ success?: boolean }>(
    `${args.pageId}/subscribed_apps`,
    args.pageAccessToken,
    { subscribed_fields: "leadgen" },
  );
  return { success: res.success === true };
}

/**
 * App-level webhook subscription: registers/updates the Meta app's Page
 * webhook subscription (callback URL + verify token + leadgen field).
 * Meta synchronously verifies the callback URL with a GET challenge, so
 * the URL must be publicly reachable and the verify token must match.
 * Uses the app access token (`app_id|app_secret`).
 */
export async function subscribeAppToLeadgenWebhook(args: {
  callbackUrl: string;
  verifyToken: string;
}): Promise<{ success: boolean }> {
  const appId = metaAppId();
  const secret = metaAppSecret();
  if (!appId || !secret) throw new Error("Meta app not configured");
  const res = await graphPost<{ success?: boolean }>(
    `${appId}/subscriptions`,
    `${appId}|${secret}`,
    {
      object: "page",
      callback_url: args.callbackUrl,
      verify_token: args.verifyToken,
      fields: "leadgen",
      include_values: "true",
    },
  );
  return { success: res.success === true };
}

/** The single (most recent) connection row, or null. */
export async function getConnection(): Promise<MetaConnection | null> {
  const [row] = await db
    .select()
    .from(metaConnectionsTable)
    .orderBy(desc(metaConnectionsTable.createdAt))
    .limit(1);
  return row ?? null;
}

export function userToken(conn: MetaConnection): string | null {
  return conn.userTokenEncrypted ? decryptToken(conn.userTokenEncrypted) : null;
}

export function pageToken(conn: MetaConnection): string | null {
  return conn.pageTokenEncrypted ? decryptToken(conn.pageTokenEncrypted) : null;
}

export async function markConnectionError(
  id: string,
  status: "token_expired" | "error",
  message: string,
): Promise<void> {
  await db
    .update(metaConnectionsTable)
    .set({ status, lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(metaConnectionsTable.id, id));
}

/** Disconnect: wipe tokens, keep historical reporting data. */
export async function disconnect(id: string): Promise<void> {
  await db
    .update(metaConnectionsTable)
    .set({
      status: "disconnected",
      userTokenEncrypted: null,
      pageTokenEncrypted: null,
      updatedAt: new Date(),
    })
    .where(eq(metaConnectionsTable.id, id));
}
