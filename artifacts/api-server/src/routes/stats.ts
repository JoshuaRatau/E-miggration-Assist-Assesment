import { Router, type IRouter } from "express";
import { db, prelaunchLeadsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdminAuth } from "../lib/adminAuth";

const router: IRouter = Router();

router.get("/stats/summary", async (_req, res) => {
  const [totals] = await db
    .select({
      totalAssessments: sql<number>`COUNT(*)::int`,
      avgScore: sql<number>`COALESCE(AVG(${prelaunchLeadsTable.leadScore}), 0)::float`,
      last24Hours: sql<number>`COUNT(*) FILTER (WHERE ${prelaunchLeadsTable.createdAt} > NOW() - INTERVAL '24 hours')::int`,
    })
    .from(prelaunchLeadsTable);

  const byCategoryRows = await db
    .select({
      category: sql<string>`COALESCE(${prelaunchLeadsTable.leadCategory}, 'Unclassified')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(prelaunchLeadsTable)
    .groupBy(prelaunchLeadsTable.leadCategory);

  const byPriorityRows = await db
    .select({
      category: sql<string>`COALESCE(${prelaunchLeadsTable.leadPriority}, 'UNCLASSIFIED')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(prelaunchLeadsTable)
    .groupBy(prelaunchLeadsTable.leadPriority);

  const byStatusRows = await db
    .select({
      category: sql<string>`COALESCE(${prelaunchLeadsTable.leadStatus}, 'NEW')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(prelaunchLeadsTable)
    .groupBy(prelaunchLeadsTable.leadStatus);

  return res.json({
    totalAssessments: totals?.totalAssessments ?? 0,
    last24Hours: totals?.last24Hours ?? 0,
    avgScore: Math.round((totals?.avgScore ?? 0) * 10) / 10,
    byCategory: byCategoryRows.map((r) => ({
      category: r.category,
      count: r.count,
    })),
    byPriority: byPriorityRows.map((r) => ({
      category: r.category,
      count: r.count,
    })),
    byStatus: byStatusRows.map((r) => ({
      category: r.category,
      count: r.count,
    })),
  });
});

// Dual-funnel mix endpoint feeding the Lead Intelligence Dashboard.
//   - Individuals are bucketed by `immigration_situation` rolled up
//     into three operator-facing categories — overstay / in_country_visa /
//     first_time_entry — matching the executive-dashboard spec. The raw
//     enum has 5 values (overstay / valid / expired / visa_required /
//     job_offer) plus historical NULLs; the rollup collapses them into
//     the funnel the sales team actually thinks in.
//   - Professionals are bucketed by `organization_type` (law_firm,
//     immigration_consultancy, global_mobility, independent_practitioner)
//     for the donut so partner-mix is visible at a glance.
// All-time counts (no time window) — operator chose "all_time_inquiry"
// during product spec. Adding a windowed variant later is a one-line
// extension via a `WHERE created_at > NOW() - INTERVAL ...` predicate.
router.get("/stats/lead-mix", async (req, res) => {
  // Admin-gated: although the response is aggregate-only, it still
  // exposes pipeline composition (B2C inquiry mix + B2B partner mix)
  // which is internal business intelligence. Session-cookie OR legacy
  // x-admin-token both satisfy the guard via the shared middleware.
  if (!(await requireAdminAuth(req, res))) return;
  // Rollup expression — kept inline so the bucket key set is fully
  // visible alongside the SQL. Any new immigration_situation enum
  // value will land in `first_time_entry` by default (the catch-all),
  // which is the safest bucket since "we don't yet know" leans pre-entry.
  const situationBucket = sql<string>`
    CASE
      WHEN ${prelaunchLeadsTable.immigrationSituation} = 'overstay'
        THEN 'overstay'
      WHEN ${prelaunchLeadsTable.immigrationSituation} IN ('valid', 'expired')
        THEN 'in_country_visa'
      ELSE 'first_time_entry'
    END
  `;
  const individualsRows = await db
    .select({
      bucket: situationBucket,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(prelaunchLeadsTable)
    .where(sql`${prelaunchLeadsTable.leadType} = 'individual'`)
    .groupBy(situationBucket);

  const professionalsRows = await db
    .select({
      bucket: sql<string>`COALESCE(${prelaunchLeadsTable.organizationType}, 'unspecified')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(prelaunchLeadsTable)
    .where(sql`${prelaunchLeadsTable.leadType} = 'professional'`)
    .groupBy(prelaunchLeadsTable.organizationType);

  const sum = (rows: { count: number }[]) =>
    rows.reduce((acc, r) => acc + r.count, 0);

  return res.json({
    individuals: {
      total: sum(individualsRows),
      buckets: individualsRows,
    },
    professionals: {
      total: sum(professionalsRows),
      buckets: professionalsRows,
    },
  });
});

// Phase 3 — per-source attribution performance.
//
// One row per known `source` channel with three counts:
//   - leads:     all-time leads bucketed into that source (off-list / NULL
//                values collapse to "other" the same way the dashboard
//                badge and filter do, so the row total here matches the
//                dashboard's filtered view exactly).
//   - converted: subset whose leadStatus has reached the terminal
//                "converted" state.
//   - last30d:   leads created within the last 30 days — momentum signal
//                that lets the operator see whether a channel is still
//                producing or has gone cold.
// Conversion percentage is intentionally NOT pre-computed server-side;
// the client renders it as `converted/leads` so re-bucketing logic can
// stay UI-side without an extra trip back to the API.
router.get("/stats/source-mix", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  // Bucket expression mirrors the frontend's `normalizeLeadSource`
  // (see `lib/leadSource.ts`) byte-for-byte:
  //   1. NULL collapses to `web_form` (canonical default for legacy
  //      rows that pre-date Phase 2).
  //   2. The string is then `lower(trim(...))`-canonicalized BEFORE
  //      the allow-list check, so historical rows with stray
  //      whitespace or mixed case (`' LinkedIn '`) bucket the same
  //      way the dashboard chip / filter would render them.
  //   3. **Batch-suffix stripping:** the CSV importer writes values
  //      like `csv_import:97c8e7b6` (the suffix is the import-batch
  //      id) — without `split_part` those rows would fall into
  //      `other` and B2B imports would look unattributed. We split
  //      on `:` and keep the prefix so any `csv_import:*` collapses
  //      to `csv_import`. Same treatment given to all other channels
  //      so future suffixed imports (e.g. `manual:opname`) bucket
  //      sanely too.
  //   4. Anything that survives canonicalization but isn't on the
  //      allow-list falls into `other`.
  const canonicalSource = sql<string>`SPLIT_PART(LOWER(TRIM(COALESCE(${prelaunchLeadsTable.source}, 'web_form'))), ':', 1)`;
  const sourceBucket = sql<string>`
    CASE
      WHEN ${canonicalSource} IN (
        'web_form','referral','linkedin','facebook','google','direct',
        'csv_import','manual','api','other'
      ) THEN ${canonicalSource}
      ELSE 'other'
    END
  `;

  const rows = await db
    .select({
      source: sourceBucket,
      leads: sql<number>`COUNT(*)::int`,
      converted: sql<number>`COUNT(*) FILTER (WHERE ${prelaunchLeadsTable.leadStatus} = 'converted')::int`,
      last30d: sql<number>`COUNT(*) FILTER (WHERE ${prelaunchLeadsTable.createdAt} > NOW() - INTERVAL '30 days')::int`,
    })
    .from(prelaunchLeadsTable)
    .groupBy(sourceBucket);

  // Sort by leads desc so the highest-volume channel is at the top —
  // the dashboard renders the rows in this order without re-sorting.
  rows.sort((a, b) => b.leads - a.leads);

  return res.json({
    rows,
    totals: {
      leads: rows.reduce((acc, r) => acc + r.leads, 0),
      converted: rows.reduce((acc, r) => acc + r.converted, 0),
      last30d: rows.reduce((acc, r) => acc + r.last30d, 0),
    },
  });
});

// ---------------------------------------------------------------------------
// /stats/source-attribution — Phase 6E enhanced source intelligence.
//
// Powers the dashboard's "Source Performance" card. Accepts a time
// `range` and a B2C/B2B `segment` filter; returns
//   - per-source rows (leads / converted / conv-rate / growth%)
//   - a date-bucketed time series for the multi-line trend chart
//   - auto-generated insights for the operator-summary panel
//   - totals echoed back so the table footer can render without a
//     second client-side reduce.
//
// Deliberately bespoke (not in OpenAPI). The shape will iterate over
// the next phase; pinning it in the spec now would force codegen
// churn for every tweak. Frontend fetches it directly via fetch +
// react-query.

type RangeKey = "7d" | "30d" | "1m" | "3m" | "6m" | "all";
type SegmentKey = "all" | "b2c" | "b2b";

interface RangeMeta {
  /** Postgres interval clause for the CURRENT window, or null for "all". */
  intervalSql: string | null;
  /**
   * Bucket width for the time-series. Postgres `date_trunc` unit:
   * shorter ranges use day, longer ranges use week, "all" uses month.
   */
  bucket: "day" | "week" | "month";
  /** Number of buckets we expect to render — informational. */
  approxBuckets: number;
}

const RANGE_META: Record<RangeKey, RangeMeta> = {
  "7d": { intervalSql: "7 days", bucket: "day", approxBuckets: 7 },
  "30d": { intervalSql: "30 days", bucket: "day", approxBuckets: 30 },
  "1m": { intervalSql: "1 month", bucket: "day", approxBuckets: 30 },
  "3m": { intervalSql: "3 months", bucket: "week", approxBuckets: 13 },
  "6m": { intervalSql: "6 months", bucket: "week", approxBuckets: 26 },
  all: { intervalSql: null, bucket: "month", approxBuckets: 24 },
};

const KNOWN_SOURCES = [
  "web_form",
  "referral",
  "linkedin",
  "facebook",
  "google",
  "direct",
  "csv_import",
  "manual",
  "api",
  "other",
] as const;
type KnownSource = (typeof KNOWN_SOURCES)[number];

const SOURCE_LABELS: Record<KnownSource, string> = {
  web_form: "Web form",
  referral: "Referral",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  google: "Google",
  direct: "Direct",
  csv_import: "CSV import",
  manual: "Manual",
  api: "API",
  other: "Other",
};

router.get("/stats/source-attribution", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const rangeRaw = String(req.query.range ?? "30d") as RangeKey;
  const segmentRaw = String(req.query.segment ?? "all") as SegmentKey;
  const range: RangeKey = (Object.keys(RANGE_META) as RangeKey[]).includes(
    rangeRaw,
  )
    ? rangeRaw
    : "30d";
  const segment: SegmentKey = (["all", "b2c", "b2b"] as const).includes(
    segmentRaw,
  )
    ? segmentRaw
    : "all";
  const meta = RANGE_META[range];

  // Same canonicalisation as /source-mix — strips `:batch` suffix so
  // `csv_import:<batchId>` rows (written by the CSV importer) bucket
  // as `csv_import` instead of falling into `other`.
  const canonicalSource = sql<string>`SPLIT_PART(LOWER(TRIM(COALESCE(${prelaunchLeadsTable.source}, 'web_form'))), ':', 1)`;
  const sourceBucket = sql<string>`
    CASE
      WHEN ${canonicalSource} IN (
        'web_form','referral','linkedin','facebook','google','direct',
        'csv_import','manual','api','other'
      ) THEN ${canonicalSource}
      ELSE 'other'
    END
  `;

  // WHERE clauses. We compose them inline since drizzle's sql template
  // is happy to be concatenated into the same query body.
  const segmentClause = sql.raw(
    segment === "b2c"
      ? `AND lead_type = 'individual'`
      : segment === "b2b"
        ? `AND lead_type = 'professional'`
        : "",
  );
  const currentRangeClause = meta.intervalSql
    ? sql.raw(`AND created_at > NOW() - INTERVAL '${meta.intervalSql}'`)
    : sql.raw("");
  // Previous-period clause is the equal-length window immediately
  // before the current one — used to compute growth %.
  const prevRangeClause = meta.intervalSql
    ? sql.raw(
        `AND created_at > NOW() - INTERVAL '${meta.intervalSql}' * 2 AND created_at <= NOW() - INTERVAL '${meta.intervalSql}'`,
      )
    : sql.raw("");

  // 1. Per-source counts in the CURRENT window (+ converted +
  //    previous-period leads for growth %).
  const rows = await db.execute(sql<{
    source: string;
    leads: number;
    converted: number;
    prev_leads: number;
  }>`
    SELECT
      ${sourceBucket} AS source,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE lead_status = 'converted')::int AS converted,
      ${
        meta.intervalSql === null
          ? sql.raw("0::int")
          : sql`(
        SELECT COUNT(*)::int FROM prelaunch_leads p2
        WHERE
          CASE
            WHEN SPLIT_PART(LOWER(TRIM(COALESCE(p2.source, 'web_form'))), ':', 1) IN (
              'web_form','referral','linkedin','facebook','google','direct',
              'csv_import','manual','api','other'
            )
            THEN SPLIT_PART(LOWER(TRIM(COALESCE(p2.source, 'web_form'))), ':', 1)
            ELSE 'other'
          END = ${sourceBucket}
          ${prevRangeClause}
          ${segment === "b2c" ? sql.raw("AND p2.lead_type = 'individual'") : segment === "b2b" ? sql.raw("AND p2.lead_type = 'professional'") : sql.raw("")}
      )`
      } AS prev_leads
    FROM prelaunch_leads
    WHERE 1=1
      ${currentRangeClause}
      ${segmentClause}
    GROUP BY source
    ORDER BY leads DESC
  `);

  type Row = {
    source: string;
    leads: number;
    converted: number;
    prev_leads: number;
  };
  // node-postgres returns Result with `.rows`; drizzle's execute mirrors
  // that. We guard for both shapes.
  const rawRows: Row[] = (
    Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows: Row[] }).rows ?? [])
  ) as Row[];

  const enrichedRows = rawRows.map((r) => {
    const leads = Number(r.leads) || 0;
    const prev = Number(r.prev_leads) || 0;
    const conv = Number(r.converted) || 0;
    const growthPct =
      meta.intervalSql === null
        ? null
        : prev === 0
          ? leads === 0
            ? 0
            : null // new channel — undefined growth
          : Math.round(((leads - prev) / prev) * 1000) / 10;
    return {
      source: r.source,
      label: SOURCE_LABELS[r.source as KnownSource] ?? r.source,
      leads,
      converted: conv,
      conversionPct: leads > 0 ? Math.round((conv / leads) * 1000) / 10 : 0,
      growthPct,
    };
  });

  // 2. Time-series buckets for the chart. We pivot in JS rather than
  //    SQL because the active-source set is small and JS is cheaper to
  //    iterate than a CROSSTAB.
  const seriesRows = await db.execute(sql<{
    bucket: string;
    source: string;
    leads: number;
  }>`
    SELECT
      to_char(date_trunc('${sql.raw(meta.bucket)}', created_at), 'YYYY-MM-DD') AS bucket,
      ${sourceBucket} AS source,
      COUNT(*)::int AS leads
    FROM prelaunch_leads
    WHERE 1=1
      ${currentRangeClause}
      ${segmentClause}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `);
  const rawSeries = (
    Array.isArray(seriesRows)
      ? seriesRows
      : ((seriesRows as unknown as { rows: unknown[] }).rows ?? [])
  ) as { bucket: string; source: string; leads: number }[];

  const bucketSet = new Set<string>();
  const pivot = new Map<string, Record<string, number>>();
  for (const row of rawSeries) {
    bucketSet.add(row.bucket);
    const entry = pivot.get(row.bucket) ?? {};
    entry[row.source] = Number(row.leads) || 0;
    pivot.set(row.bucket, entry);
  }
  const series = Array.from(bucketSet)
    .sort()
    .map((date) => {
      const entry = pivot.get(date) ?? {};
      // Backfill 0 for known sources so the chart line is continuous.
      const point: Record<string, string | number> = { date };
      for (const s of enrichedRows) {
        point[s.source] = entry[s.source] ?? 0;
      }
      return point;
    });

  // 3. Totals
  const totals = enrichedRows.reduce(
    (acc, r) => {
      acc.leads += r.leads;
      acc.converted += r.converted;
      return acc;
    },
    { leads: 0, converted: 0 },
  );
  const totalsConvPct =
    totals.leads > 0
      ? Math.round((totals.converted / totals.leads) * 1000) / 10
      : 0;

  // 4. Auto-insights — pure derivations from `enrichedRows`. Kept
  //    deliberately small so the panel stays scannable.
  const insights: { tone: "positive" | "neutral" | "warning"; text: string }[] =
    [];
  if (enrichedRows.length > 0) {
    const topVolume = [...enrichedRows].sort((a, b) => b.leads - a.leads)[0];
    if (topVolume && topVolume.leads > 0) {
      insights.push({
        tone: "neutral",
        text: `${topVolume.label} produced the highest lead volume (${topVolume.leads} leads).`,
      });
    }
    const topConv = [...enrichedRows]
      .filter((r) => r.leads >= 3)
      .sort((a, b) => b.conversionPct - a.conversionPct)[0];
    if (topConv && topConv.conversionPct > 0) {
      insights.push({
        tone: "positive",
        text: `${topConv.label} achieved the highest conversion efficiency at ${topConv.conversionPct}%.`,
      });
    }
    const fastest = [...enrichedRows]
      .filter((r) => r.growthPct !== null && r.leads >= 3)
      .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))[0];
    if (fastest && (fastest.growthPct ?? 0) > 25) {
      insights.push({
        tone: "positive",
        text: `${fastest.label} is the fastest-growing channel (+${fastest.growthPct}% vs previous period).`,
      });
    }
    const declining = [...enrichedRows]
      .filter((r) => r.growthPct !== null && r.leads >= 3)
      .sort((a, b) => (a.growthPct ?? 0) - (b.growthPct ?? 0))[0];
    if (declining && (declining.growthPct ?? 0) < -25) {
      insights.push({
        tone: "warning",
        text: `${declining.label} engagement declining (${declining.growthPct}% vs previous period).`,
      });
    }
  }
  if (insights.length === 0) {
    insights.push({
      tone: "neutral",
      text: "Not enough activity in this window to surface insights yet.",
    });
  }

  return res.json({
    range,
    segment,
    bucket: meta.bucket,
    rows: enrichedRows,
    totals: {
      leads: totals.leads,
      converted: totals.converted,
      conversionPct: totalsConvPct,
    },
    series,
    insights,
  });
});

export default router;
