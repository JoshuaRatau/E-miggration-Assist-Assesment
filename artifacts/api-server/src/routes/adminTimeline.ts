import { Router, type IRouter } from "express";
import {
  db,
  prelaunchLeadsTable,
  leadAuditTable,
  leadEngagementsTable,
  adminUsersTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdminAuth } from "../lib/adminAuth";

const router: IRouter = Router();

// Phase 3 — read-only per-lead activity timeline.
//
// Three sources are unioned in-memory (rather than via a SQL UNION) so
// each row keeps its strongly-typed shape and the response payload can
// stay declarative. None of the sources is large per-lead in practice
// (audit + engagement rows accrue tens, not thousands), so the cost of
// fetching each independently and merging client-side is negligible
// and gains us flexibility (e.g. adding case_messages later is one
// extra await, not a SQL refactor).
//
// The endpoint is intentionally NOT modelled in OpenAPI's full Lead
// detail surface — it's a sibling resource. Keeping it dedicated lets
// us evolve the timeline shape without disturbing the Lead contract.
router.get("/admin/leads/:id/timeline", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const id = req.params.id;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing lead id" });
  }

  // 1. The lead itself — used both to confirm existence (404) and to
  //    seed the synthetic "lead_created" event at the bottom of the
  //    feed so the timeline always has at least one entry.
  const [lead] = await db
    .select({
      id: prelaunchLeadsTable.id,
      createdAt: prelaunchLeadsTable.createdAt,
      referenceNumber: prelaunchLeadsTable.referenceNumber,
      source: prelaunchLeadsTable.source,
      sourceCampaign: prelaunchLeadsTable.sourceCampaign,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, id))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  // 2. Audit rows — joined to admin_users so the timeline can render
  //    "Jane changed status" without a second round-trip. Left join so
  //    legacy x-admin-token entries (actorUserId NULL) still surface.
  const auditRows = await db
    .select({
      id: leadAuditTable.id,
      action: leadAuditTable.action,
      before: leadAuditTable.before,
      after: leadAuditTable.after,
      createdAt: leadAuditTable.createdAt,
      actorUserId: leadAuditTable.actorUserId,
      actorEmail: adminUsersTable.email,
    })
    .from(leadAuditTable)
    .leftJoin(
      adminUsersTable,
      eq(adminUsersTable.id, leadAuditTable.actorUserId),
    )
    .where(eq(leadAuditTable.leadId, id))
    .orderBy(desc(leadAuditTable.createdAt));

  // 3. Outbound engagement attempts (email + whatsapp). These are
  //    operator-driven sends; inbound case_messages are intentionally
  //    OUT of scope for Phase 3 (they belong to the case, not the
  //    lead, and a deferred Phase will add them).
  const engagementRows = await db
    .select({
      id: leadEngagementsTable.id,
      channel: leadEngagementsTable.channel,
      type: leadEngagementsTable.type,
      status: leadEngagementsTable.status,
      message: leadEngagementsTable.message,
      createdAt: leadEngagementsTable.createdAt,
    })
    .from(leadEngagementsTable)
    .where(eq(leadEngagementsTable.leadId, id))
    .orderBy(desc(leadEngagementsTable.createdAt));

  type Entry = {
    kind: "audit" | "engagement" | "lead_created";
    at: string;
    title: string;
    detail?: string | null;
    actorEmail?: string | null;
    meta?: Record<string, unknown>;
  };

  const entries: Entry[] = [];

  for (const a of auditRows) {
    entries.push({
      kind: "audit",
      at: a.createdAt.toISOString(),
      title: a.action,
      actorEmail: a.actorEmail ?? null,
      meta: {
        before: a.before ?? null,
        after: a.after ?? null,
      },
    });
  }
  for (const e of engagementRows) {
    entries.push({
      kind: "engagement",
      at: e.createdAt.toISOString(),
      title: `${e.channel}_${e.type}`,
      detail: e.message ?? null,
      meta: { status: e.status },
    });
  }
  entries.push({
    kind: "lead_created",
    at: lead.createdAt.toISOString(),
    title: "lead_created",
    meta: {
      source: lead.source,
      sourceCampaign: lead.sourceCampaign,
      referenceNumber: lead.referenceNumber,
    },
  });

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return res.json({
    leadId: lead.id,
    referenceNumber: lead.referenceNumber,
    entries,
  });
});

export default router;
