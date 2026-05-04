import { Router, type IRouter } from "express";
import { db, prelaunchLeadsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

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

  return res.json({
    totalAssessments: totals?.totalAssessments ?? 0,
    last24Hours: totals?.last24Hours ?? 0,
    avgScore: Math.round((totals?.avgScore ?? 0) * 10) / 10,
    byCategory: byCategoryRows.map((r) => ({
      category: r.category,
      count: r.count,
    })),
  });
});

export default router;
