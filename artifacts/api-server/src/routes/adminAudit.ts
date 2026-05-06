import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAdminToken } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";

/**
 * Frontend-instrumented audit endpoint.
 *
 * Some auditable admin actions live entirely in the browser — clicking
 * a `tel:` or `mailto:` link to contact a lead, for example, never
 * reaches a server route on its own. The admin UI fires this endpoint
 * with the action it just performed so the audit trail captures it.
 *
 * The endpoint is admin-gated (cookie session OR legacy x-admin-token)
 * and the action is constrained to a small allow-list so a compromised
 * browser session cannot poison the audit log with arbitrary strings.
 */

const router: IRouter = Router();

const ALLOWED_ACTIONS = ["manual_contact_click"] as const;

const auditBody = z.object({
  action: z.enum(ALLOWED_ACTIONS),
  leadId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

router.post("/admin/audit", async (req, res) => {
  if (!(await requireAdminToken(req, res))) return;

  const parsed = auditBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid audit body", details: parsed.error.issues });
  }
  const { action, leadId, caseId, payload } = parsed.data;

  await writeAudit({
    req,
    action,
    leadId: leadId ?? null,
    caseId: caseId ?? null,
    after: payload ?? null,
  });

  return res.status(201).json({ ok: true });
});

export default router;
