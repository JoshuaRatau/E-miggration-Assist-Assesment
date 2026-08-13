import {
  db,
  metaAdSetsTable,
  metaAdsTable,
  metaCampaignsTable,
  metaConnectionsTable,
  metaContentInsightsTable,
  metaInsightsDailyTable,
  metaLeadFormsTable,
  metaLeadsTable,
  metaSyncRunsTable,
  type MetaConnection,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { GraphError, graphGet, graphGetAll } from "./metaClient";
import { getConnection, markConnectionError, pageToken, userToken } from "./metaAuth";
import { fbMetricNames, igMetricNames } from "./metaMetrics";
import { importMetaLeadToCrm } from "./metaLeadImport";

// Sync service: Meta API → database. The dashboard reads ONLY from the
// database; syncs are triggered manually (Refresh button), on schedule
// (30-min in-process ticker), and leads additionally arrive near-real-time
// via webhook.
//
// Each section is independent — a permission failure in one records
// an error string for that section and moves on (partial sync).

let syncInFlight = false;

export function isSyncRunning(): boolean {
  return syncInFlight;
}

type SectionResult = "ok" | string; // "ok" | error summary

function errSummary(err: unknown): string {
  if (err instanceof GraphError) return `${err.kind}: ${err.message}`.slice(0, 200);
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function upsertDailyMetric(row: {
  accountType: string;
  accountId: string;
  metricName: string;
  metricValue: number | null;
  metricBreakdown?: unknown;
  breakdownKey?: string;
  metricDate: string;
  period?: string;
}): Promise<void> {
  await db
    .insert(metaInsightsDailyTable)
    .values({
      accountType: row.accountType,
      accountId: row.accountId,
      metricName: row.metricName,
      metricValue: row.metricValue !== null ? String(row.metricValue) : null,
      metricBreakdown: row.metricBreakdown ?? null,
      breakdownKey: row.breakdownKey ?? "",
      metricDate: row.metricDate,
      period: row.period ?? "day",
    })
    .onConflictDoUpdate({
      target: [
        metaInsightsDailyTable.accountType,
        metaInsightsDailyTable.accountId,
        metaInsightsDailyTable.metricName,
        metaInsightsDailyTable.metricDate,
        metaInsightsDailyTable.period,
        metaInsightsDailyTable.breakdownKey,
      ],
      set: {
        metricValue: row.metricValue !== null ? String(row.metricValue) : null,
        metricBreakdown: row.metricBreakdown ?? null,
        updatedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// Section: Facebook Page daily insights

type InsightValue = { value?: unknown; end_time?: string };
type InsightItem = { name?: string; period?: string; values?: InsightValue[] };

async function syncFacebookInsights(conn: MetaConnection, sinceDays: number): Promise<SectionResult> {
  const token = pageToken(conn);
  if (!conn.facebookPageId || !token) return "no facebook page connected";
  try {
    const since = new Date(Date.now() - sinceDays * 86400_000);
    // Request metrics individually-tolerant: one bad metric shouldn't kill
    // the whole batch, so chunk requests per metric.
    for (const metric of fbMetricNames()) {
      try {
        const res = await graphGet<{ data?: InsightItem[] }>(
          `${conn.facebookPageId}/insights`,
          token,
          {
            metric,
            period: "day",
            since: isoDay(since),
            until: isoDay(new Date()),
          },
        );
        for (const item of res.data ?? []) {
          for (const v of item.values ?? []) {
            const day = v.end_time ? v.end_time.slice(0, 10) : null;
            if (!day) continue;
            const numeric = typeof v.value === "number" ? v.value : null;
            await upsertDailyMetric({
              accountType: "facebook_page",
              accountId: conn.facebookPageId,
              metricName: item.name ?? metric,
              metricValue: numeric,
              metricBreakdown: typeof v.value === "object" ? v.value : undefined,
              metricDate: day,
            });
          }
        }
      } catch (err) {
        // An expired token fails EVERY metric the same way — abort the
        // section and surface it so runFullSync flips the connection.
        if (err instanceof GraphError && err.kind === "token_expired") throw err;
        logger.warn({ metric, err: errSummary(err) }, "FB metric unavailable");
      }
    }
    return "ok";
  } catch (err) {
    return errSummary(err);
  }
}

// ---------------------------------------------------------------------------
// Section: Instagram daily insights

async function syncInstagramInsights(conn: MetaConnection, sinceDays: number): Promise<SectionResult> {
  const token = pageToken(conn) ?? userToken(conn);
  if (!conn.instagramAccountId || !token) return "no instagram account connected";
  try {
    const since = new Date(Date.now() - sinceDays * 86400_000);
    for (const metric of igMetricNames()) {
      try {
        const params: Record<string, string> = {
          metric,
          period: "day",
          since: isoDay(since),
          until: isoDay(new Date()),
        };
        // Newer IG metrics require metric_type=total_value.
        if (["views", "profile_views", "total_interactions", "follows_and_unfollows"].includes(metric)) {
          params.metric_type = "total_value";
        }
        const res = await graphGet<{ data?: (InsightItem & { total_value?: { value?: number } })[] }>(
          `${conn.instagramAccountId}/insights`,
          token,
          params,
        );
        for (const item of res.data ?? []) {
          if (item.values?.length) {
            for (const v of item.values) {
              const day = v.end_time ? v.end_time.slice(0, 10) : null;
              if (!day) continue;
              await upsertDailyMetric({
                accountType: "instagram",
                accountId: conn.instagramAccountId,
                metricName: item.name ?? metric,
                metricValue: typeof v.value === "number" ? v.value : null,
                metricBreakdown: typeof v.value === "object" ? v.value : undefined,
                metricDate: day,
              });
            }
          } else if (item.total_value?.value !== undefined) {
            // total_value has no per-day series — store on today's date as
            // a lifetime-period snapshot.
            await upsertDailyMetric({
              accountType: "instagram",
              accountId: conn.instagramAccountId,
              metricName: item.name ?? metric,
              metricValue: item.total_value.value ?? null,
              metricDate: isoDay(new Date()),
              period: "lifetime",
            });
          }
        }
      } catch (err) {
        if (err instanceof GraphError && err.kind === "token_expired") throw err;
        logger.warn({ metric, err: errSummary(err) }, "IG metric unavailable");
      }
    }
    return "ok";
  } catch (err) {
    return errSummary(err);
  }
}

// ---------------------------------------------------------------------------
// Section: audience demographics (lifetime snapshots)

async function syncAudience(conn: MetaConnection): Promise<SectionResult> {
  const token = pageToken(conn) ?? userToken(conn);
  if (!conn.instagramAccountId || !token) return "no instagram account connected";
  try {
    const res = await graphGet<{ data?: Array<{ name?: string; total_value?: { breakdowns?: Array<{ dimension_keys?: string[]; results?: Array<{ dimension_values?: string[]; value?: number }> }> } }> }>(
      `${conn.instagramAccountId}/insights`,
      token,
      {
        metric: "follower_demographics",
        period: "lifetime",
        metric_type: "total_value",
        breakdown: "country",
      },
    );
    for (const item of res.data ?? []) {
      const breakdown = item.total_value?.breakdowns?.[0];
      if (!breakdown) continue;
      const map: Record<string, number> = {};
      for (const r of breakdown.results ?? []) {
        const k = r.dimension_values?.join("/") ?? "?";
        map[k] = r.value ?? 0;
      }
      await upsertDailyMetric({
        accountType: "instagram",
        accountId: conn.instagramAccountId,
        metricName: "follower_demographics_country",
        metricValue: null,
        metricBreakdown: map,
        metricDate: isoDay(new Date()),
        period: "lifetime",
      });
    }
    return "ok";
  } catch (err) {
    return errSummary(err);
  }
}

// ---------------------------------------------------------------------------
// Section: ad campaigns / ad sets / ads (Marketing API)

type InsightsRow = {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
  cost_per_action_type?: Array<{ action_type?: string; value?: string }>;
};

function actionCount(row: InsightsRow, type: string): number | null {
  const a = row.actions?.find((x) => x.action_type === type);
  return a?.value !== undefined ? Number(a.value) : null;
}

function actionCost(row: InsightsRow, type: string): string | null {
  const a = row.cost_per_action_type?.find((x) => x.action_type === type);
  return a?.value ?? null;
}

async function syncCampaigns(conn: MetaConnection): Promise<SectionResult> {
  const token = userToken(conn);
  if (!conn.adAccountId || !token) return "no ad account connected";
  try {
    const campaigns = await graphGetAll<{
      id: string;
      name?: string;
      status?: string;
      objective?: string;
      start_time?: string;
      stop_time?: string;
    }>(`${conn.adAccountId}/campaigns`, token, {
      fields: "id,name,status,objective,start_time,stop_time",
    });

    for (const c of campaigns) {
      let ins: InsightsRow = {};
      try {
        const insRes = await graphGet<{ data?: InsightsRow[] }>(`${c.id}/insights`, token, {
          fields: "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
          date_preset: "maximum",
        });
        ins = insRes.data?.[0] ?? {};
      } catch (err) {
        logger.warn({ campaign: c.id, err: errSummary(err) }, "campaign insights unavailable");
      }
      const leads = actionCount(ins, "lead");
      const conversions = actionCount(ins, "offsite_conversion.fb_pixel_lead") ?? actionCount(ins, "purchase");
      const values = {
        adAccountId: conn.adAccountId,
        name: c.name ?? c.id,
        status: c.status ?? null,
        objective: c.objective ?? null,
        startTime: c.start_time ? new Date(c.start_time) : null,
        stopTime: c.stop_time ? new Date(c.stop_time) : null,
        spend: ins.spend ?? null,
        impressions: ins.impressions ? Number(ins.impressions) : null,
        reach: ins.reach ? Number(ins.reach) : null,
        clicks: ins.clicks ? Number(ins.clicks) : null,
        ctr: ins.ctr ?? null,
        cpc: ins.cpc ?? null,
        cpm: ins.cpm ?? null,
        leads,
        costPerLead: actionCost(ins, "lead"),
        conversions,
        costPerConversion: actionCost(ins, "offsite_conversion.fb_pixel_lead"),
        raw: c as unknown,
        updatedAt: new Date(),
      };
      await db
        .insert(metaCampaignsTable)
        .values({ metaCampaignId: c.id, ...values })
        .onConflictDoUpdate({ target: metaCampaignsTable.metaCampaignId, set: values });
    }

    // Ad sets + ads (flat account-level queries, campaign linkage via fields)
    const adsets = await graphGetAll<{ id: string; name?: string; status?: string; campaign_id?: string }>(
      `${conn.adAccountId}/adsets`,
      token,
      { fields: "id,name,status,campaign_id" },
    );
    for (const s of adsets) {
      const values = {
        metaCampaignId: s.campaign_id ?? "",
        name: s.name ?? s.id,
        status: s.status ?? null,
        raw: s as unknown,
        updatedAt: new Date(),
      };
      await db
        .insert(metaAdSetsTable)
        .values({ metaAdSetId: s.id, ...values })
        .onConflictDoUpdate({ target: metaAdSetsTable.metaAdSetId, set: values });
    }
    const ads = await graphGetAll<{ id: string; name?: string; status?: string; adset_id?: string; campaign_id?: string }>(
      `${conn.adAccountId}/ads`,
      token,
      { fields: "id,name,status,adset_id,campaign_id" },
    );
    for (const a of ads) {
      const values = {
        metaAdSetId: a.adset_id ?? "",
        metaCampaignId: a.campaign_id ?? "",
        name: a.name ?? a.id,
        status: a.status ?? null,
        raw: a as unknown,
        updatedAt: new Date(),
      };
      await db
        .insert(metaAdsTable)
        .values({ metaAdId: a.id, ...values })
        .onConflictDoUpdate({ target: metaAdsTable.metaAdId, set: values });
    }
    return "ok";
  } catch (err) {
    return errSummary(err);
  }
}

// ---------------------------------------------------------------------------
// Section: lead forms + leads (Lead Ads)

type LeadgenRow = {
  id: string;
  created_time?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  form_id?: string;
  platform?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
};

function fieldValue(row: LeadgenRow, names: string[]): string | null {
  for (const f of row.field_data ?? []) {
    const n = (f.name ?? "").toLowerCase();
    if (names.some((x) => n.includes(x))) return f.values?.[0] ?? null;
  }
  return null;
}

export async function upsertLeadFromGraph(row: LeadgenRow, pageId: string | null): Promise<void> {
  const values = {
    pageId,
    metaCampaignId: row.campaign_id ?? null,
    metaAdSetId: row.adset_id ?? null,
    metaAdId: row.ad_id ?? null,
    metaFormId: row.form_id ?? null,
    platform: row.platform === "instagram" ? "instagram" : row.platform === "facebook" ? "facebook" : "unknown",
    fullName: fieldValue(row, ["full_name", "name"]),
    email: fieldValue(row, ["email"]),
    phone: fieldValue(row, ["phone"]),
    fieldData: row.field_data ?? null,
    metaCreatedAt: row.created_time ? new Date(row.created_time) : null,
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(metaLeadsTable)
    .values({ metaLeadId: row.id, ...values })
    .onConflictDoUpdate({ target: metaLeadsTable.metaLeadId, set: { updatedAt: new Date() } })
    .returning();
  if (saved) await importMetaLeadToCrm(saved);
}

async function syncLeadForms(conn: MetaConnection): Promise<SectionResult> {
  const token = pageToken(conn);
  if (!conn.facebookPageId || !token) return "no facebook page connected";
  try {
    const forms = await graphGetAll<{ id: string; name?: string; status?: string; questions?: unknown; leads_count?: number }>(
      `${conn.facebookPageId}/leadgen_forms`,
      token,
      { fields: "id,name,status,questions,leads_count" },
    );
    for (const f of forms) {
      const values = {
        pageId: conn.facebookPageId,
        name: f.name ?? null,
        status: f.status ?? null,
        questions: f.questions ?? null,
        leadsCount: f.leads_count ?? null,
        updatedAt: new Date(),
      };
      await db
        .insert(metaLeadFormsTable)
        .values({ metaFormId: f.id, ...values })
        .onConflictDoUpdate({ target: metaLeadFormsTable.metaFormId, set: values });

      // Pull leads per form.
      try {
        const rows = await graphGetAll<LeadgenRow>(`${f.id}/leads`, token, {
          fields: "id,created_time,campaign_id,adset_id,ad_id,form_id,platform,field_data",
        });
        for (const row of rows) await upsertLeadFromGraph(row, conn.facebookPageId);
      } catch (err) {
        logger.warn({ formId: f.id, err: errSummary(err) }, "lead retrieval unavailable for form");
      }
    }
    return "ok";
  } catch (err) {
    return errSummary(err);
  }
}

// ---------------------------------------------------------------------------
// Section: content insights (FB posts + IG media)

async function syncContent(conn: MetaConnection): Promise<SectionResult> {
  const results: string[] = [];
  const pToken = pageToken(conn);
  if (conn.facebookPageId && pToken) {
    try {
      const posts = await graphGetAll<{
        id: string;
        message?: string;
        created_time?: string;
        permalink_url?: string;
        full_picture?: string;
        attachments?: { data?: Array<{ media_type?: string }> };
        shares?: { count?: number };
      }>(`${conn.facebookPageId}/published_posts`, pToken, {
        fields: "id,message,created_time,permalink_url,full_picture,attachments{media_type},shares",
      }, 200);
      for (const p of posts) {
        let likes: number | null = null;
        let comments: number | null = null;
        let reach: number | null = null;
        try {
          const ins = await graphGet<{ data?: InsightItem[] }>(`${p.id}/insights`, pToken, {
            metric: "post_impressions_unique",
          });
          const v = ins.data?.[0]?.values?.[0]?.value;
          reach = typeof v === "number" ? v : null;
        } catch { /* per-post insights may be unavailable */ }
        try {
          const sum = await graphGet<{ likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
            p.id,
            pToken,
            { fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)" },
          );
          likes = sum.likes?.summary?.total_count ?? null;
          comments = sum.comments?.summary?.total_count ?? null;
        } catch { /* engagement summary optional */ }
        const mediaType = p.attachments?.data?.[0]?.media_type?.toLowerCase() ?? "post";
        const values = {
          platform: "facebook",
          contentType: ["photo", "image"].includes(mediaType) ? "image" : mediaType.includes("video") ? "video" : "post",
          permalink: p.permalink_url ?? null,
          thumbnailUrl: p.full_picture ?? null,
          caption: p.message?.slice(0, 500) ?? null,
          publishedAt: p.created_time ? new Date(p.created_time) : null,
          reach,
          likes,
          comments,
          shares: p.shares?.count ?? null,
          raw: null,
          updatedAt: new Date(),
        };
        await db
          .insert(metaContentInsightsTable)
          .values({ metaContentId: p.id, ...values })
          .onConflictDoUpdate({ target: metaContentInsightsTable.metaContentId, set: values });
      }
      results.push("fb:ok");
    } catch (err) {
      results.push(`fb:${errSummary(err)}`);
    }
  }

  const iToken = pToken ?? userToken(conn);
  if (conn.instagramAccountId && iToken) {
    try {
      const media = await graphGetAll<{
        id: string;
        caption?: string;
        media_type?: string;
        media_product_type?: string;
        permalink?: string;
        thumbnail_url?: string;
        media_url?: string;
        timestamp?: string;
        like_count?: number;
        comments_count?: number;
      }>(`${conn.instagramAccountId}/media`, iToken, {
        fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
      }, 200);
      for (const m of media) {
        let views: number | null = null;
        let reach: number | null = null;
        let saves: number | null = null;
        let shares: number | null = null;
        let interactions: number | null = null;
        try {
          const ins = await graphGet<{ data?: Array<{ name?: string; values?: InsightValue[] }> }>(
            `${m.id}/insights`,
            iToken,
            { metric: "views,reach,saved,shares,total_interactions" },
          );
          for (const item of ins.data ?? []) {
            const v = item.values?.[0]?.value;
            const n = typeof v === "number" ? v : null;
            if (item.name === "views") views = n;
            else if (item.name === "reach") reach = n;
            else if (item.name === "saved") saves = n;
            else if (item.name === "shares") shares = n;
            else if (item.name === "total_interactions") interactions = n;
          }
        } catch { /* per-media insights may be unavailable */ }
        const type =
          m.media_product_type === "REELS" ? "reel"
          : m.media_product_type === "STORY" ? "story"
          : m.media_type === "VIDEO" ? "video"
          : m.media_type === "IMAGE" ? "image"
          : "post";
        const values = {
          platform: "instagram",
          contentType: type,
          permalink: m.permalink ?? null,
          thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
          caption: m.caption?.slice(0, 500) ?? null,
          publishedAt: m.timestamp ? new Date(m.timestamp) : null,
          views,
          reach,
          likes: m.like_count ?? null,
          comments: m.comments_count ?? null,
          saves,
          shares,
          interactions,
          raw: null,
          updatedAt: new Date(),
        };
        await db
          .insert(metaContentInsightsTable)
          .values({ metaContentId: m.id, ...values })
          .onConflictDoUpdate({ target: metaContentInsightsTable.metaContentId, set: values });
      }
      results.push("ig:ok");
    } catch (err) {
      results.push(`ig:${errSummary(err)}`);
    }
  }
  if (!results.length) return "no connected content sources";
  return results.every((r) => r.endsWith("ok")) ? "ok" : results.join("; ");
}

// ---------------------------------------------------------------------------
// Orchestrator

export async function runFullSync(trigger: "manual" | "scheduled"): Promise<{
  ok: boolean;
  runId: string | null;
  sections: Record<string, SectionResult>;
  error?: string;
}> {
  // Acquire the mutex BEFORE any await — otherwise two callers can both
  // pass the check while the first is still resolving the connection.
  if (syncInFlight) return { ok: false, runId: null, sections: {}, error: "sync_already_running" };
  syncInFlight = true;

  let conn;
  try {
    conn = await getConnection();
  } catch (err) {
    syncInFlight = false;
    throw err;
  }
  if (!conn || conn.status === "disconnected" || !conn.userTokenEncrypted) {
    syncInFlight = false;
    return { ok: false, runId: null, sections: {}, error: "not_connected" };
  }
  const [run] = await db
    .insert(metaSyncRunsTable)
    .values({ connectionId: conn.id, trigger, status: "running" })
    .returning();

  const sections: Record<string, SectionResult> = {};
  try {
    // First sync backfills 90 days; subsequent syncs refresh a 7-day window.
    const sinceDays = conn.lastSyncedAt ? 7 : 90;
    sections.facebook_insights = await syncFacebookInsights(conn, sinceDays);
    sections.instagram_insights = await syncInstagramInsights(conn, sinceDays);
    sections.audience = await syncAudience(conn);
    sections.campaigns = await syncCampaigns(conn);
    sections.lead_forms = await syncLeadForms(conn);
    sections.content = await syncContent(conn);

    const values = Object.values(sections);
    const allOk = values.every((v) => v === "ok");
    const anyOk = values.some((v) => v === "ok");
    // Any section reporting an expired token means auth is broken —
    // treat the run as failed and flip the connection to the reconnect
    // state, regardless of what other sections managed to do.
    const tokenExpired = values.some(
      (v) => typeof v === "string" && v.startsWith("token_expired"),
    );
    const status = tokenExpired ? "failed" : allOk ? "success" : anyOk ? "partial" : "failed";

    await db
      .update(metaSyncRunsTable)
      .set({ status, sections, finishedAt: new Date() })
      .where(eq(metaSyncRunsTable.id, run!.id));

    if (tokenExpired) {
      await markConnectionError(
        conn.id,
        "token_expired",
        "Meta access token expired — reconnect required",
      );
    } else {
      await db
        .update(metaConnectionsTable)
        .set({
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          ...(allOk ? { status: "active", lastError: null } : {}),
        })
        .where(eq(metaConnectionsTable.id, conn.id));
    }

    logger.info({ trigger, status, sections }, "Meta sync finished");
    return { ok: anyOk, runId: run!.id, sections };
  } catch (err) {
    const msg = errSummary(err);
    await db
      .update(metaSyncRunsTable)
      .set({ status: "failed", sections, errorMessage: msg, finishedAt: new Date() })
      .where(eq(metaSyncRunsTable.id, run!.id));
    logger.error({ err: msg }, "Meta sync crashed");
    return { ok: false, runId: run!.id, sections, error: msg };
  } finally {
    syncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduled sync — same in-process single-replica ticker pattern as
// campaignScheduleWorker. 45-minute interval; skips when not connected.

const SYNC_INTERVAL_MS = 45 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export function startMetaSyncWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      try {
        const conn = await getConnection();
        if (!conn || conn.status !== "active") return;
        await runFullSync("scheduled");
      } catch (err) {
        logger.error({ err: errSummary(err) }, "scheduled Meta sync failed");
      }
    })();
  }, SYNC_INTERVAL_MS);
  timer.unref?.();
  logger.info({ intervalMs: SYNC_INTERVAL_MS }, "Meta sync worker started");
}

export function stopMetaSyncWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
