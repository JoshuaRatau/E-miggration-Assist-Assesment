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
//   - Individuals are bucketed by `inquiry_type` (visa_inquiry,
//     overstay_appeal, travel_entry_assistance) — surfaced in the bar
//     chart so operators see which service line is generating demand.
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
  const individualsRows = await db
    .select({
      bucket: sql<string>`COALESCE(${prelaunchLeadsTable.inquiryType}, 'unspecified')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(prelaunchLeadsTable)
    .where(sql`${prelaunchLeadsTable.leadType} = 'individual'`)
    .groupBy(prelaunchLeadsTable.inquiryType);

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
