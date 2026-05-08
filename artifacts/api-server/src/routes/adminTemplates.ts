import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  commTemplatesTable,
  type CommTemplate,
} from "@workspace/db";
import { requireAdminAuth } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";
import {
  renderTemplate,
  findUnknownTokens,
} from "../lib/campaignRender";

// Phase 5 Phase E — Draft Templates (§3.C).
//
// Endpoints (all require admin session cookie):
//   GET    /api/admin/templates            ?category=&channel=&includeArchived=
//   POST   /api/admin/templates
//   GET    /api/admin/templates/:id
//   PATCH  /api/admin/templates/:id
//   POST   /api/admin/templates/:id/archive    (soft delete)
//   POST   /api/admin/templates/:id/unarchive
//   POST   /api/admin/templates/:id/preview    (render against sample ctx)

const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CategoryEnum = z.enum([
  "promotional",
  "system_update",
  "new_feature",
  "educational",
  "customer_experience",
]);
const ChannelEnum = z.enum(["email", "whatsapp"]);

const CreateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: CategoryEnum,
    channel: ChannelEnum,
    subject: z.string().trim().max(200).nullable().optional(),
    body: z.string().trim().min(1).max(5000),
  })
  .refine(
    (v) =>
      v.channel !== "email" ||
      (typeof v.subject === "string" && v.subject.trim().length > 0),
    {
      message: "Email templates require a subject.",
      path: ["subject"],
    },
  );

const PatchTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: CategoryEnum.optional(),
  // channel is intentionally NOT patchable — switching channel mid-life
  // would invalidate subject/body assumptions. Operator should clone
  // into a new template instead.
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1).max(5000).optional(),
});

function serializeTemplate(t: CommTemplate) {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    channel: t.channel,
    subject: t.subject,
    body: t.body,
    unknownTokens: findUnknownTokens(t.body),
    createdBy: t.createdBy,
    updatedBy: t.updatedBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// list

router.get("/admin/templates", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const category = typeof req.query["category"] === "string"
    ? req.query["category"]
    : undefined;
  const channel = typeof req.query["channel"] === "string"
    ? req.query["channel"]
    : undefined;
  const includeArchived = req.query["includeArchived"] === "true";

  const conditions = [];
  if (category && CategoryEnum.safeParse(category).success) {
    conditions.push(eq(commTemplatesTable.category, category));
  }
  if (channel && ChannelEnum.safeParse(channel).success) {
    conditions.push(eq(commTemplatesTable.channel, channel));
  }
  if (!includeArchived) {
    conditions.push(isNull(commTemplatesTable.archivedAt));
  }

  const rows = await db
    .select()
    .from(commTemplatesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(commTemplatesTable.updatedAt));

  res.json({ templates: rows.map(serializeTemplate) });
});

// ---------------------------------------------------------------------------
// create

router.post("/admin/templates", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;

  const parsed = CreateTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
    return;
  }

  const adminId = req.adminUser?.id ?? null;
  const inserted = await db
    .insert(commTemplatesTable)
    .values({
      name: parsed.data.name,
      category: parsed.data.category,
      channel: parsed.data.channel,
      subject: parsed.data.channel === "email" ? parsed.data.subject ?? null : null,
      body: parsed.data.body,
      createdBy: adminId,
      updatedBy: adminId,
    })
    .returning();

  const row = inserted[0]!;
  void writeAudit({
    req,
    action: "comm_template_create",
    after: {
      templateId: row.id,
      name: row.name,
      category: row.category,
      channel: row.channel,
    },
  });

  res.status(201).json({ template: serializeTemplate(row) });
});

// ---------------------------------------------------------------------------
// get

router.get("/admin/templates/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const rows = await db
    .select()
    .from(commTemplatesTable)
    .where(eq(commTemplatesTable.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ template: serializeTemplate(row) });
});

// ---------------------------------------------------------------------------
// patch

router.patch("/admin/templates/:id", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const parsed = PatchTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
    return;
  }

  const existingRows = await db
    .select()
    .from(commTemplatesTable)
    .where(eq(commTemplatesTable.id, id))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (existing.archivedAt) {
    res.status(409).json({ error: "archived_template_immutable" });
    return;
  }

  // Email-channel invariant: if the patch sets subject to empty/null
  // on an email template, refuse — same rule as create.
  if (
    existing.channel === "email" &&
    parsed.data.subject !== undefined &&
    (parsed.data.subject === null || parsed.data.subject.trim().length === 0)
  ) {
    res.status(400).json({
      error: "validation_failed",
      details: { subject: "Email templates require a subject." },
    });
    return;
  }

  const updated = await db
    .update(commTemplatesTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.category !== undefined
        ? { category: parsed.data.category }
        : {}),
      ...(parsed.data.subject !== undefined
        ? {
            subject:
              existing.channel === "email" ? parsed.data.subject : null,
          }
        : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      updatedBy: req.adminUser?.id ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(commTemplatesTable.id, id))
    .returning();

  const row = updated[0]!;
  void writeAudit({
    req,
    action: "comm_template_update",
    after: { templateId: row.id, fields: Object.keys(parsed.data) },
  });
  res.json({ template: serializeTemplate(row) });
});

// ---------------------------------------------------------------------------
// archive / unarchive

router.post("/admin/templates/:id/archive", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const updated = await db
    .update(commTemplatesTable)
    .set({ archivedAt: sql`now()`, updatedBy: req.adminUser?.id ?? null })
    .where(
      and(eq(commTemplatesTable.id, id), isNull(commTemplatesTable.archivedAt)),
    )
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "not_found_or_already_archived" });
    return;
  }
  void writeAudit({
    req,
    action: "comm_template_archive",
    after: { templateId: id },
  });
  res.json({ template: serializeTemplate(updated[0]!) });
});

router.post("/admin/templates/:id/unarchive", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const updated = await db
    .update(commTemplatesTable)
    .set({ archivedAt: null, updatedBy: req.adminUser?.id ?? null })
    .where(eq(commTemplatesTable.id, id))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  void writeAudit({
    req,
    action: "comm_template_unarchive",
    after: { templateId: id },
  });
  res.json({ template: serializeTemplate(updated[0]!) });
});

// ---------------------------------------------------------------------------
// preview — render against a fixed sample context

router.post("/admin/templates/:id/preview", async (req, res) => {
  if (!(await requireAdminAuth(req, res))) return;
  const id = req.params["id"];
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const rows = await db
    .select()
    .from(commTemplatesTable)
    .where(eq(commTemplatesTable.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Fixed sample context; matches the four supported tokens.
  const ctx = {
    fullName: "Alex Mokoena",
    referenceNumber: "EMA-DEMO-0001",
    organizationName: "Acme Immigration Co",
  };
  res.json({
    subject: row.subject ? renderTemplate(row.subject, ctx) : null,
    body: renderTemplate(row.body, ctx),
    unknownTokens: findUnknownTokens(row.body),
  });
});

export default router;
