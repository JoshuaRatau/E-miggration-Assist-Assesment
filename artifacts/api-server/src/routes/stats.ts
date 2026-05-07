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

export default router;
