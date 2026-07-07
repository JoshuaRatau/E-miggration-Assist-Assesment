import { createHash } from "node:crypto";
import type { Request } from "express";
import { db, leadAuditTable } from "@workspace/db";
import { readSessionCookie } from "./adminSession";

/**
 * Append-only admin audit trail.
 *
 * Every privileged mutation should call `writeAudit` after the durable
 * change has succeeded. The function is intentionally fire-and-forget at
 * the call site (errors are logged, never rethrown) so an audit-write
 * failure cannot mask the underlying business operation.
 *
 * NEVER store the raw credential. We hash whatever the caller used to
 * authenticate (cookie session id OR legacy x-admin-token header) with
 * sha256 and persist only the hex digest. The hash is opaque but lets
 * us correlate multiple actions by the same actor without leaking the
 * secret.
 */

export type AuditAction =
  | "lead_status_changed"
  | "lead_priority_changed"
  | "lead_notes_changed"
  | "lead_note_added"
  | "lead_intended_tier_changed"
  | "lead_assigned_changed"
  | "lead_followup_scheduled"
  | "lead_followup_updated"
  | "lead_followup_completed"
  | "lead_followup_removed"
  | "lead_conversion_started"
  | "lead_conversion_blocked"
  | "lead_conversion_failed"
  | "lead_converted"
  | "case_status_changed"
  | "document_downloaded"
  | "manual_contact_click"
  | "outbound_message_attempted";

export function actorTokenHash(req: Request): string | null {
  const sessionId = readSessionCookie(req);
  if (sessionId) {
    return createHash("sha256").update(sessionId).digest("hex");
  }
  const headerVal = req.header("x-admin-token");
  if (typeof headerVal === "string" && headerVal.length > 0) {
    return createHash("sha256").update(headerVal).digest("hex");
  }
  return null;
}

export interface WriteAuditArgs {
  req: Request;
  action: AuditAction | string;
  leadId?: string | null;
  caseId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(args: WriteAuditArgs): Promise<void> {
  try {
    await db.insert(leadAuditTable).values({
      action: args.action,
      leadId: args.leadId ?? null,
      caseId: args.caseId ?? null,
      actorTokenHash: actorTokenHash(args.req),
      // CRM Phase A: when session-cookie auth populated req.adminUser, ALSO
      // record the operator's id so the activity-timeline UI can render an
      // attributed actor without reversing the hash. Legacy x-admin-token
      // callers leave this null by design.
      actorUserId: args.req.adminUser?.id ?? null,
      before: (args.before ?? null) as never,
      after: (args.after ?? null) as never,
    });
  } catch (err) {
    args.req.log.warn(
      { err, action: args.action, leadId: args.leadId, caseId: args.caseId },
      "Failed to write audit row (non-fatal)",
    );
  }
}
