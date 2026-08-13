import { db, metaConnectionsTable, type MetaConnection } from "@workspace/db";
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
import { graphGet, graphGetAll } from "./metaClient";

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
  url.searchParams.set("scope", OAUTH_SCOPES);
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
  const page = pages[0] ?? null;

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
    status: "active",
    lastError: null,
    connectedByUserId: args.connectedByUserId,
    updatedAt: new Date(),
  };

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
