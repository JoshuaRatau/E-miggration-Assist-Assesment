import { Router, type IRouter, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import {
  db,
  metaAdSetsTable,
  metaAdsTable,
  metaCampaignsTable,
  metaContentInsightsTable,
  metaInsightsDailyTable,
  metaLeadFormsTable,
  metaLeadsTable,
  metaSyncRunsTable,
  metaWebhookEventsTable,
  prelaunchLeadsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireAdminAuth } from "../lib/adminAuth";
import { logger } from "../lib/logger";
import {
  frontendReturnUrl,
  isConfigured,
  metaAppSecret,
  redirectUri,
  validateOauthState,
  webhookCallbackUrl,
  webhookVerifyToken,
} from "../services/meta/metaConfig";
import {
  buildAuthUrl,
  completeConnection,
  disconnect,
  exchangeCodeForLongLivedToken,
  getConnection,
  listAvailablePages,
  pageToken,
  selectPage,
  subscribeAppToLeadgenWebhook,
  subscribePageToLeadgen,
} from "../services/meta/metaAuth";
import { graphGet } from "../services/meta/metaClient";
import { METRICS, metricByKey, type InternalMetricKey } from "../services/meta/metaMetrics";
import { isSyncRunning, runFullSync, upsertLeadFromGraph } from "../services/meta/metaSync";

// Meta Analytics module routes. All /api/meta/* endpoints are admin-only
// EXCEPT: /auth/callback (Meta redirects the browser here mid-OAuth) and
// /webhook (Meta server-to-server, verified by app-secret signature).

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// helpers

const DateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseRange(req: { query: Record<string, unknown> }): { from: string; to: string } | null {
  const parsed = DateRangeSchema.safeParse({ from: req.query.from, to: req.query.to });
  return parsed.success ? parsed.data : null;
}

function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round((t - f) / 86400_000) + 1);
  const prevTo = new Date(f - 86400_000);
  const prevFrom = new Date(f - days * 86400_000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null; // avoid div-by-zero
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Sum a mapped internal metric over a date range, per platform filter. */
async function sumMetric(
  key: InternalMetricKey,
  from: string,
  to: string,
  platform: "all" | "facebook" | "instagram",
): Promise<number | null> {
  const def = metricByKey.get(key);
  if (!def) return null;
  if (key === "leads") {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(metaLeadsTable)
      .where(
        and(
          gte(metaLeadsTable.metaCreatedAt, new Date(`${from}T00:00:00Z`)),
          lte(metaLeadsTable.metaCreatedAt, new Date(`${to}T23:59:59Z`)),
          ...(platform !== "all" ? [eq(metaLeadsTable.platform, platform)] : []),
        ),
      );
    return row?.n ?? 0;
  }
  const names: Array<{ accountType: string; metric: string }> = [];
  if (def.facebookMetric && platform !== "instagram")
    names.push({ accountType: "facebook_page", metric: def.facebookMetric });
  if (def.instagramMetric && platform !== "facebook")
    names.push({ accountType: "instagram", metric: def.instagramMetric });
  if (!names.length) return null;

  let total: number | null = null;
  for (const n of names) {
    const [row] = await db
      .select({ s: sql<string | null>`sum(${metaInsightsDailyTable.metricValue})` })
      .from(metaInsightsDailyTable)
      .where(
        and(
          eq(metaInsightsDailyTable.accountType, n.accountType),
          eq(metaInsightsDailyTable.metricName, n.metric),
          eq(metaInsightsDailyTable.period, "day"),
          eq(metaInsightsDailyTable.breakdownKey, ""),
          gte(metaInsightsDailyTable.metricDate, from),
          lte(metaInsightsDailyTable.metricDate, to),
        ),
      );
    if (row?.s !== null && row?.s !== undefined) total = (total ?? 0) + Number(row.s);
  }
  return total;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]): void {
  const body = [header, ...rows].map((r) => (r as unknown[]).map(csvEscape).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

// ---------------------------------------------------------------------------
// status

router.get("/meta/status", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const conn = await getConnection();
  const [lastRun] = await db
    .select()
    .from(metaSyncRunsTable)
    .orderBy(desc(metaSyncRunsTable.startedAt))
    .limit(1);
  return res.json({
    appConfigured: isConfigured(),
    redirectUri: redirectUri(),
    syncRunning: isSyncRunning(),
    connection: conn
      ? {
          status: conn.status,
          facebookPageId: conn.facebookPageId,
          facebookPageName: conn.facebookPageName,
          instagramAccountId: conn.instagramAccountId,
          instagramUsername: conn.instagramUsername,
          adAccountId: conn.adAccountId,
          adAccountName: conn.adAccountName,
          tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
          lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
          lastError: conn.lastError,
          connectedAt: conn.createdAt.toISOString(),
        }
      : null,
    lastSync: lastRun
      ? {
          status: lastRun.status,
          trigger: lastRun.trigger,
          sections: lastRun.sections,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// OAuth

router.get("/meta/auth/start", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  if (!isConfigured()) {
    return res.status(503).json({
      error: "Meta app not configured. Set META_APP_ID and META_APP_SECRET.",
    });
  }
  try {
    return res.json({ url: buildAuthUrl() });
  } catch (err) {
    req.log.error({ err: err instanceof Error ? err.message : String(err) }, "meta auth start failed");
    return res.status(500).json({ error: "Could not start Meta login" });
  }
});

router.get("/meta/auth/callback", async (req, res) => {
  const back = frontendReturnUrl();
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  if (!validateOauthState(state)) {
    req.log.warn("meta oauth callback: invalid state");
    return res.redirect(`${back}?connect_error=invalid_state`);
  }
  if (!code) {
    return res.redirect(`${back}?connect_error=denied`);
  }
  try {
    const { token, expiresAt } = await exchangeCodeForLongLivedToken(code);
    await completeConnection({
      userToken: token,
      tokenExpiresAt: expiresAt,
      connectedByUserId: null, // browser redirect — admin cookie may not ride along cross-origin
    });
    // Fire an initial sync in the background so data appears quickly.
    void runFullSync("manual");
    return res.redirect(`${back}?connected=1`);
  } catch (err) {
    req.log.error({ err: err instanceof Error ? err.message : String(err) }, "meta oauth callback failed");
    return res.redirect(`${back}?connect_error=exchange_failed`);
  }
});

// List all Pages the connected Meta user manages (for the page switcher).
router.get("/meta/pages", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const conn = await getConnection();
  if (!conn || conn.status === "disconnected") {
    return res.status(404).json({ error: "No Meta connection" });
  }
  try {
    const pages = await listAvailablePages(conn);
    return res.json({ pages });
  } catch (err) {
    req.log.error({ err: err instanceof Error ? err.message : String(err) }, "meta pages list failed");
    return res.status(502).json({ error: "Could not load Pages from Meta" });
  }
});

// Switch the connection to a different Page and re-sync.
const SelectPageSchema = z.object({ pageId: z.string().min(1) });
router.post("/meta/select-page", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const parsed = SelectPageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "pageId required" });
  const conn = await getConnection();
  if (!conn || conn.status === "disconnected") {
    return res.status(404).json({ error: "No Meta connection" });
  }
  // Never switch mid-sync: the in-flight run holds a snapshot of the old
  // connection and would write old-page data against the new selection.
  if (isSyncRunning()) {
    return res.status(409).json({
      error: "A data sync is currently running. Wait for it to finish, then try again.",
    });
  }
  try {
    const updated = await selectPage(conn, parsed.data.pageId);
    req.log.info({ pageId: parsed.data.pageId }, "meta connection switched page");
    // Re-sync in the background so the dashboard reflects the new Page.
    void runFullSync("manual");
    return res.json({
      ok: true,
      facebookPageId: updated.facebookPageId,
      facebookPageName: updated.facebookPageName,
      instagramUsername: updated.instagramUsername,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "meta select-page failed");
    return res.status(502).json({ error: "Could not switch Page" });
  }
});

router.post("/meta/disconnect", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const conn = await getConnection();
  if (!conn) return res.status(404).json({ error: "No Meta connection" });
  await disconnect(conn.id);
  req.log.info("meta connection disconnected");
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// webhook page subscription (instant lead delivery)

/**
 * One-off (idempotent) subscribe of the connected Page to the app's
 * leadgen webhook. New connections do this automatically during OAuth;
 * this endpoint covers connections made before that existed, and lets an
 * admin re-run it. Returns the Page's current subscribed_fields so the
 * caller can confirm leadgen is active.
 */
router.post("/meta/webhook/subscribe", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  // 1) App-level subscription: register the callback URL + verify token +
  //    leadgen field with the Meta app (equivalent to the dashboard's
  //    Webhooks config). Meta verifies the callback URL synchronously.
  //    Runs even without a connected account — it only needs app creds.
  let appSubscription: { success: boolean; callbackUrl: string } | { error: string };
  const callbackUrl = webhookCallbackUrl();
  const verifyToken = webhookVerifyToken();
  if (callbackUrl && verifyToken) {
    try {
      const appSub = await subscribeAppToLeadgenWebhook({ callbackUrl, verifyToken });
      appSubscription = { success: appSub.success, callbackUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.warn({ err: msg, callbackUrl }, "meta app webhook subscription failed");
      appSubscription = { error: msg };
    }
  } else {
    appSubscription = {
      error: "META_WEBHOOK_VERIFY_TOKEN or callback URL not configured",
    };
  }

  // 2) Page-level subscription: subscribe THIS page to the app's webhook.
  const conn = await getConnection();
  if (!conn || conn.status === "disconnected")
    return res.status(400).json({ error: "Meta account not connected", appSubscription });
  if (!conn.facebookPageId)
    return res.status(400).json({ error: "No Facebook Page on the connection", appSubscription });
  const token = pageToken(conn);
  if (!token)
    return res.status(400).json({
      error: "No page token stored — reconnect the Meta account",
      appSubscription,
    });

  try {
    const sub = await subscribePageToLeadgen({
      pageId: conn.facebookPageId,
      pageAccessToken: token,
    });
    // Read back the subscription so the response reflects actual state.
    const check = await graphGet<{
      data?: Array<{ id?: string; name?: string; subscribed_fields?: string[] }>;
    }>(`${conn.facebookPageId}/subscribed_apps`, token, {
      fields: "id,name,subscribed_fields",
    });
    const fields = check.data?.[0]?.subscribed_fields ?? [];
    req.log.info(
      { pageId: conn.facebookPageId, success: sub.success, fields },
      "meta webhook page subscription",
    );
    return res.json({
      success: sub.success,
      pageId: conn.facebookPageId,
      pageName: conn.facebookPageName,
      subscribedFields: fields,
      leadgenActive: fields.includes("leadgen"),
      appSubscription,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "meta webhook page subscription failed");
    return res.status(502).json({ error: `Page subscription failed: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// sync

router.post("/meta/sync", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  if (isSyncRunning()) return res.status(409).json({ error: "Sync already running" });
  const result = await runFullSync("manual");
  if (!result.ok && result.error === "not_connected")
    return res.status(400).json({ error: "Meta account not connected" });
  return res.json(result);
});

// ---------------------------------------------------------------------------
// overview + performance

const PlatformSchema = z.enum(["all", "facebook", "instagram"]).default("all");

router.get("/meta/overview", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const range = parseRange(req as never);
  if (!range) return res.status(400).json({ error: "from/to (YYYY-MM-DD) required" });
  const platform = PlatformSchema.parse(req.query.platform ?? "all");
  const prev = previousRange(range.from, range.to);

  const kpis = [];
  for (const def of METRICS) {
    const current = await sumMetric(def.key, range.from, range.to, platform);
    const previous = await sumMetric(def.key, prev.from, prev.to, platform);
    kpis.push({
      key: def.key,
      label: def.label,
      format: def.format ?? "number",
      current,
      previous,
      changePct: pctChange(current, previous),
      available: current !== null,
    });
  }
  return res.json({ range, previousRange: prev, platform, kpis });
});

router.get("/meta/performance", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const range = parseRange(req as never);
  if (!range) return res.status(400).json({ error: "from/to (YYYY-MM-DD) required" });
  const platform = PlatformSchema.parse(req.query.platform ?? "all");
  const key = (typeof req.query.metric === "string" ? req.query.metric : "views") as InternalMetricKey;
  const def = metricByKey.get(key);
  if (!def) return res.status(400).json({ error: "Unknown metric" });

  const names: Array<{ accountType: string; metric: string }> = [];
  if (def.facebookMetric && platform !== "instagram")
    names.push({ accountType: "facebook_page", metric: def.facebookMetric });
  if (def.instagramMetric && platform !== "facebook")
    names.push({ accountType: "instagram", metric: def.instagramMetric });

  const byDay = new Map<string, number>();
  if (key === "leads") {
    const rows = await db
      .select({
        day: sql<string>`to_char(${metaLeadsTable.metaCreatedAt}, 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(metaLeadsTable)
      .where(
        and(
          gte(metaLeadsTable.metaCreatedAt, new Date(`${range.from}T00:00:00Z`)),
          lte(metaLeadsTable.metaCreatedAt, new Date(`${range.to}T23:59:59Z`)),
        ),
      )
      .groupBy(sql`1`);
    for (const r of rows) if (r.day) byDay.set(r.day, r.n);
  } else if (names.length) {
    const rows = await db
      .select({
        day: metaInsightsDailyTable.metricDate,
        accountType: metaInsightsDailyTable.accountType,
        metricName: metaInsightsDailyTable.metricName,
        value: metaInsightsDailyTable.metricValue,
      })
      .from(metaInsightsDailyTable)
      .where(
        and(
          eq(metaInsightsDailyTable.period, "day"),
          eq(metaInsightsDailyTable.breakdownKey, ""),
          gte(metaInsightsDailyTable.metricDate, range.from),
          lte(metaInsightsDailyTable.metricDate, range.to),
          inArray(metaInsightsDailyTable.metricName, names.map((n) => n.metric)),
        ),
      );
    for (const r of rows) {
      if (!names.some((n) => n.accountType === r.accountType && n.metric === r.metricName)) continue;
      if (r.value === null) continue;
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.value));
    }
  }

  // Dense series (fill missing days with 0 so the chart is continuous).
  const series: Array<{ date: string; value: number }> = [];
  for (
    let t = new Date(`${range.from}T00:00:00Z`).getTime();
    t <= new Date(`${range.to}T00:00:00Z`).getTime();
    t += 86400_000
  ) {
    const d = new Date(t).toISOString().slice(0, 10);
    series.push({ date: d, value: byDay.get(d) ?? 0 });
  }
  return res.json({ metric: key, label: def.label, platform, range, series, available: names.length > 0 || key === "leads" });
});

// ---------------------------------------------------------------------------
// audience

router.get("/meta/audience", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const range = parseRange(req as never);
  if (!range) return res.status(400).json({ error: "from/to (YYYY-MM-DD) required" });

  const follows = await sumMetric("follows", range.from, range.to, "all");
  const unfollows = await sumMetric("unfollows", range.from, range.to, "all");
  const reach = await sumMetric("reach", range.from, range.to, "all");

  const [demoRow] = await db
    .select()
    .from(metaInsightsDailyTable)
    .where(
      and(
        eq(metaInsightsDailyTable.metricName, "follower_demographics_country"),
        eq(metaInsightsDailyTable.period, "lifetime"),
      ),
    )
    .orderBy(desc(metaInsightsDailyTable.metricDate))
    .limit(1);

  return res.json({
    range,
    follows,
    unfollows,
    netFollows: follows !== null || unfollows !== null ? (follows ?? 0) - (unfollows ?? 0) : null,
    reach,
    demographics: {
      country: demoRow?.metricBreakdown ?? null,
      asOf: demoRow?.metricDate ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// content

router.get("/meta/content", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const range = parseRange(req as never);
  if (!range) return res.status(400).json({ error: "from/to (YYYY-MM-DD) required" });
  const platform = typeof req.query.platform === "string" ? req.query.platform : "all";
  const type = typeof req.query.type === "string" ? req.query.type : "all";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "newest";

  const conds = [
    gte(metaContentInsightsTable.publishedAt, new Date(`${range.from}T00:00:00Z`)),
    lte(metaContentInsightsTable.publishedAt, new Date(`${range.to}T23:59:59Z`)),
  ];
  if (platform === "facebook" || platform === "instagram")
    conds.push(eq(metaContentInsightsTable.platform, platform));
  if (type !== "all") conds.push(eq(metaContentInsightsTable.contentType, type));

  const orderCol =
    sort === "most_viewed" ? sql`${metaContentInsightsTable.views} DESC NULLS LAST`
    : sort === "most_engaged" ? sql`${metaContentInsightsTable.interactions} DESC NULLS LAST`
    : sort === "most_liked" ? sql`${metaContentInsightsTable.likes} DESC NULLS LAST`
    : sort === "most_shared" ? sql`${metaContentInsightsTable.shares} DESC NULLS LAST`
    : sort === "oldest" ? sql`${metaContentInsightsTable.publishedAt} ASC`
    : sql`${metaContentInsightsTable.publishedAt} DESC`;

  const rows = await db
    .select()
    .from(metaContentInsightsTable)
    .where(and(...conds))
    .orderBy(orderCol)
    .limit(200);
  return res.json({ range, items: rows });
});

// ---------------------------------------------------------------------------
// campaigns / adsets / ads

router.get("/meta/campaigns", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const rows = await db
    .select()
    .from(metaCampaignsTable)
    .orderBy(desc(metaCampaignsTable.updatedAt))
    .limit(500);

  const totals = rows.reduce(
    (acc, c) => {
      acc.spend += c.spend ? Number(c.spend) : 0;
      acc.impressions += c.impressions ?? 0;
      acc.reach += c.reach ?? 0;
      acc.clicks += c.clicks ?? 0;
      acc.leads += c.leads ?? 0;
      acc.conversions += c.conversions ?? 0;
      return acc;
    },
    { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversions: 0 },
  );
  return res.json({ campaigns: rows, totals });
});

router.get("/meta/adsets", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : null;
  if (!campaignId) return res.status(400).json({ error: "campaignId required" });
  const rows = await db
    .select()
    .from(metaAdSetsTable)
    .where(eq(metaAdSetsTable.metaCampaignId, campaignId))
    .limit(500);
  return res.json({ adSets: rows });
});

router.get("/meta/ads", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const adSetId = typeof req.query.adSetId === "string" ? req.query.adSetId : null;
  if (!adSetId) return res.status(400).json({ error: "adSetId required" });
  const rows = await db
    .select()
    .from(metaAdsTable)
    .where(eq(metaAdsTable.metaAdSetId, adSetId))
    .limit(500);
  return res.json({ ads: rows });
});

// ---------------------------------------------------------------------------
// leads

router.get("/meta/leads", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const range = parseRange(req as never);
  const conds = [];
  if (range) {
    conds.push(gte(metaLeadsTable.metaCreatedAt, new Date(`${range.from}T00:00:00Z`)));
    conds.push(lte(metaLeadsTable.metaCreatedAt, new Date(`${range.to}T23:59:59Z`)));
  }
  const rows = await db
    .select()
    .from(metaLeadsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(metaLeadsTable.metaCreatedAt))
    .limit(500);

  // Attach campaign/form names + CRM status in bulk.
  const campaignIds = [...new Set(rows.map((r) => r.metaCampaignId).filter((x): x is string => Boolean(x)))];
  const formIds = [...new Set(rows.map((r) => r.metaFormId).filter((x): x is string => Boolean(x)))];
  const crmIds = [...new Set(rows.map((r) => r.crmLeadId).filter((x): x is string => Boolean(x)))];
  const [campaigns, forms, crmLeads] = await Promise.all([
    campaignIds.length
      ? db.select({ id: metaCampaignsTable.metaCampaignId, name: metaCampaignsTable.name }).from(metaCampaignsTable).where(inArray(metaCampaignsTable.metaCampaignId, campaignIds))
      : Promise.resolve([]),
    formIds.length
      ? db.select({ id: metaLeadFormsTable.metaFormId, name: metaLeadFormsTable.name }).from(metaLeadFormsTable).where(inArray(metaLeadFormsTable.metaFormId, formIds))
      : Promise.resolve([]),
    crmIds.length
      ? db.select({ id: prelaunchLeadsTable.id, status: prelaunchLeadsTable.leadStatus, reference: prelaunchLeadsTable.referenceNumber }).from(prelaunchLeadsTable).where(inArray(prelaunchLeadsTable.id, crmIds))
      : Promise.resolve([]),
  ]);
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const formName = new Map(forms.map((f) => [f.id, f.name]));
  const crmById = new Map(crmLeads.map((l) => [l.id, l]));

  return res.json({
    leads: rows.map((r) => ({
      ...r,
      campaignName: r.metaCampaignId ? campaignName.get(r.metaCampaignId) ?? null : null,
      formName: r.metaFormId ? formName.get(r.metaFormId) ?? null : null,
      crmStatus: r.crmLeadId ? crmById.get(r.crmLeadId)?.status ?? null : null,
      crmReference: r.crmLeadId ? crmById.get(r.crmLeadId)?.reference ?? null : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// conversions — Meta acquisition × internal CRM outcomes

router.get("/meta/conversions", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const range = parseRange(req as never);
  if (!range) return res.status(400).json({ error: "from/to (YYYY-MM-DD) required" });
  const fromTs = new Date(`${range.from}T00:00:00Z`);
  const toTs = new Date(`${range.to}T23:59:59Z`);

  const [metaLeadCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(metaLeadsTable)
    .where(and(gte(metaLeadsTable.metaCreatedAt, fromTs), lte(metaLeadsTable.metaCreatedAt, toTs)));

  // CRM leads originating from Meta, joined by crm_lead_id.
  const crmStats = await db
    .select({
      status: prelaunchLeadsTable.leadStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(metaLeadsTable)
    .innerJoin(prelaunchLeadsTable, eq(metaLeadsTable.crmLeadId, prelaunchLeadsTable.id))
    .where(and(gte(metaLeadsTable.metaCreatedAt, fromTs), lte(metaLeadsTable.metaCreatedAt, toTs)))
    .groupBy(prelaunchLeadsTable.leadStatus);

  const statusMap = Object.fromEntries(crmStats.map((s) => [s.status, s.n]));
  const qualified = (statusMap["qualified"] ?? 0) + (statusMap["proposal_sent"] ?? 0) + (statusMap["ready_for_case"] ?? 0) + (statusMap["converted"] ?? 0);
  const converted = statusMap["converted"] ?? 0;

  // Meta-reported ad totals over campaign lifetimes (labelled as such —
  // Meta campaign insights here are lifetime aggregates, not date-filtered).
  const [adTotals] = await db
    .select({
      spend: sql<string | null>`sum(${metaCampaignsTable.spend})`,
      impressions: sql<string | null>`sum(${metaCampaignsTable.impressions})`,
      clicks: sql<string | null>`sum(${metaCampaignsTable.clicks})`,
      metaLeads: sql<string | null>`sum(${metaCampaignsTable.leads})`,
      metaConversions: sql<string | null>`sum(${metaCampaignsTable.conversions})`,
    })
    .from(metaCampaignsTable);

  return res.json({
    range,
    internal: {
      source: "CRM",
      metaLeads: metaLeadCount?.n ?? 0,
      qualifiedLeads: qualified,
      convertedLeads: converted,
      byStatus: statusMap,
      conversionRate:
        (metaLeadCount?.n ?? 0) > 0 ? Math.round((converted / metaLeadCount!.n) * 1000) / 10 : null,
    },
    metaReported: {
      source: "Meta Ads (campaign lifetime)",
      spend: adTotals?.spend ? Number(adTotals.spend) : null,
      impressions: adTotals?.impressions ? Number(adTotals.impressions) : null,
      clicks: adTotals?.clicks ? Number(adTotals.clicks) : null,
      leads: adTotals?.metaLeads ? Number(adTotals.metaLeads) : null,
      conversions: adTotals?.metaConversions ? Number(adTotals.metaConversions) : null,
      costPerLead:
        adTotals?.spend && adTotals?.metaLeads && Number(adTotals.metaLeads) > 0
          ? Math.round((Number(adTotals.spend) / Number(adTotals.metaLeads)) * 100) / 100
          : null,
    },
  });
});

// ---------------------------------------------------------------------------
// exports (CSV, backend-generated)

router.get("/meta/export", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";
  const range = parseRange(req as never);
  const ts = new Date().toISOString().slice(0, 10);

  if (kind === "campaigns") {
    const rows = await db.select().from(metaCampaignsTable).orderBy(desc(metaCampaignsTable.updatedAt));
    return sendCsv(res, `meta-campaigns-${ts}.csv`,
      ["Campaign", "Status", "Objective", "Start", "End", "Spend", "Impressions", "Reach", "Clicks", "CTR", "CPC", "CPM", "Leads", "CostPerLead", "Conversions"],
      rows.map((c) => [c.name, c.status, c.objective, c.startTime?.toISOString() ?? "", c.stopTime?.toISOString() ?? "", c.spend, c.impressions, c.reach, c.clicks, c.ctr, c.cpc, c.cpm, c.leads, c.costPerLead, c.conversions]));
  }
  if (kind === "leads") {
    const conds = [];
    if (range) {
      conds.push(gte(metaLeadsTable.metaCreatedAt, new Date(`${range.from}T00:00:00Z`)));
      conds.push(lte(metaLeadsTable.metaCreatedAt, new Date(`${range.to}T23:59:59Z`)));
    }
    const rows = await db.select().from(metaLeadsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(metaLeadsTable.metaCreatedAt));
    return sendCsv(res, `meta-leads-${ts}.csv`,
      ["Name", "Email", "Phone", "Platform", "CampaignId", "AdSetId", "AdId", "FormId", "CreatedAt", "ImportStatus", "CrmLeadId"],
      rows.map((l) => [l.fullName, l.email, l.phone, l.platform, l.metaCampaignId, l.metaAdSetId, l.metaAdId, l.metaFormId, l.metaCreatedAt?.toISOString() ?? "", l.importStatus, l.crmLeadId]));
  }
  if (kind === "content") {
    const conds = [];
    if (range) {
      conds.push(gte(metaContentInsightsTable.publishedAt, new Date(`${range.from}T00:00:00Z`)));
      conds.push(lte(metaContentInsightsTable.publishedAt, new Date(`${range.to}T23:59:59Z`)));
    }
    const rows = await db.select().from(metaContentInsightsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(metaContentInsightsTable.publishedAt));
    return sendCsv(res, `meta-content-${ts}.csv`,
      ["Platform", "Type", "PublishedAt", "Caption", "Views", "Reach", "Likes", "Comments", "Shares", "Saves", "Interactions", "Permalink"],
      rows.map((c) => [c.platform, c.contentType, c.publishedAt?.toISOString() ?? "", c.caption, c.views, c.reach, c.likes, c.comments, c.shares, c.saves, c.interactions, c.permalink]));
  }
  if (kind === "daily") {
    if (!range) return res.status(400).json({ error: "from/to required for daily export" });
    const rows = await db
      .select()
      .from(metaInsightsDailyTable)
      .where(and(
        eq(metaInsightsDailyTable.period, "day"),
        gte(metaInsightsDailyTable.metricDate, range.from),
        lte(metaInsightsDailyTable.metricDate, range.to),
      ))
      .orderBy(metaInsightsDailyTable.metricDate);
    return sendCsv(res, `meta-daily-${ts}.csv`,
      ["Date", "AccountType", "AccountId", "Metric", "Value"],
      rows.map((r) => [r.metricDate, r.accountType, r.accountId, r.metricName, r.metricValue]));
  }
  return res.status(400).json({ error: "kind must be one of campaigns|leads|content|daily" });
});

// ---------------------------------------------------------------------------
// webhook — Meta server-to-server. GET = subscription verification;
// POST = events (leadgen). Signature: X-Hub-Signature-256 over raw body.

router.get("/meta/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expected = webhookVerifyToken();
  if (mode === "subscribe" && expected && token === expected) {
    return res.status(200).send(String(challenge ?? ""));
  }
  return res.sendStatus(403);
});

router.post("/meta/webhook", async (req, res) => {
  const secret = metaAppSecret();
  const sig = req.header("x-hub-signature-256");
  const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!secret || !sig || !raw) return res.sendStatus(403);
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    req.log.warn("meta webhook: bad signature");
    return res.sendStatus(403);
  }

  // ACK immediately; process async (Meta retries on non-200/timeout).
  res.sendStatus(200);

  type WebhookBody = {
    object?: string;
    entry?: Array<{
      changes?: Array<{ field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string } }>;
    }>;
  };
  const body = req.body as WebhookBody;
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const leadgenId = change.value?.leadgen_id;
        const dedupeKey = leadgenId
          ? `leadgen:${leadgenId}`
          : `raw:${crypto.createHash("sha256").update(raw).digest("hex")}`;
        const [event] = await db
          .insert(metaWebhookEventsTable)
          .values({
            dedupeKey,
            object: body.object ?? null,
            field: change.field ?? null,
            payload: change.value ?? null,
          })
          .onConflictDoNothing({ target: metaWebhookEventsTable.dedupeKey })
          .returning();
        if (!event) continue; // duplicate delivery — already handled

        if (change.field === "leadgen" && leadgenId) {
          try {
            const conn = await getConnection();
            const token = conn ? pageToken(conn) : null;
            if (!token) throw new Error("no page token for lead retrieval");
            const lead = await graphGet<{
              id: string;
              created_time?: string;
              campaign_id?: string;
              adset_id?: string;
              ad_id?: string;
              form_id?: string;
              platform?: string;
              field_data?: Array<{ name?: string; values?: string[] }>;
            }>(leadgenId, token, {
              fields: "id,created_time,campaign_id,adset_id,ad_id,form_id,platform,field_data",
            });
            await upsertLeadFromGraph(lead, change.value?.page_id ?? null);
            await db
              .update(metaWebhookEventsTable)
              .set({ status: "processed", processedAt: new Date() })
              .where(eq(metaWebhookEventsTable.id, event.id));
          } catch (err) {
            await db
              .update(metaWebhookEventsTable)
              .set({
                status: "failed",
                errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 300),
                processedAt: new Date(),
              })
              .where(eq(metaWebhookEventsTable.id, event.id));
          }
        } else {
          await db
            .update(metaWebhookEventsTable)
            .set({ status: "ignored", processedAt: new Date() })
            .where(eq(metaWebhookEventsTable.id, event.id));
        }
      }
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "meta webhook processing failed",
    );
  }
  return;
});

export default router;
