import { assertControlledMutation, assertControlledRecord, checkControlledDatabase } from "./controlled";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Executor } from "./snapshots";
import { GhlFailure, validateFieldMapping, type GhlConfig, type OperationKind } from "./config";
import { type GhlClient, type Method } from "./client";
import { customValues, standardValues, historyBody, type Assessment } from "./fields";

async function rows<T = any>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  const result: any = await db.execute(query);
  return result.rows ?? result;
}
const encode = encodeURIComponent;
const fieldValue = (contact: any, id: string) => contact.customFields?.find((f: any) => f.id === id)?.value;
const opportunityValue = (opportunity: any, id: string) => opportunity.customFields?.find((f: any) => f.id === id)?.fieldValue;
const firstTouchKeys = new Set(["ema_source", "ema_source_campaign", "ema_utm_source", "ema_utm_medium", "ema_utm_campaign", "ema_funnel_context"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const reviewCodes = new Set(["IDENTITY_CONFLICT", "AMBIGUOUS_CREATE", "UNRESOLVED_UPDATE_REVIEW", "REMOTE_IDENTITY_MISMATCH", "OPPORTUNITY_OWNERSHIP_REVIEW", "MULTIPLE_REMOTE_MATCHES", "HISTORY_SIZE_REVIEW_REQUIRED", "PAGINATION_REVIEW_REQUIRED", "READBACK_MISMATCH"]);

/**
 * Processor shared by intercepted tests and explicitly enabled test delivery.
 * Runtime and client independently guard actual network access.
 */
export class GhlWorker {
  constructor(private db: Executor, private client: GhlClient, private config: GhlConfig) {
    validateFieldMapping(config.fieldIds);
    if (!["test", "development"].includes(config.environment))
      throw new GhlFailure("LIVE_GHL_WRITES_DISABLED");
  }
  async tick(): Promise<boolean> {
    validateFieldMapping(this.config.fieldIds);
    await checkControlledDatabase(this.config, this.db);
    const { environment, locationId } = this.config;
    if (!locationId) throw new GhlFailure("LOCATION_REQUIRED");
    const token = randomUUID(), scope = `${environment}:${locationId}`;
    const lease = await rows(this.db, sql`INSERT INTO ema_ghl_worker_leases(scope,token,expires_at)
      VALUES(${scope},${token},now()+interval '60 seconds')
      ON CONFLICT(scope) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
      WHERE ema_ghl_worker_leases.expires_at < now() RETURNING token`);
    if (!lease.length) return false;
    let op: any;
    const fenced = sql`EXISTS(SELECT 1 FROM ema_ghl_worker_leases WHERE scope=${scope} AND token=${token} AND expires_at>now())`;
    const renew = async () => {
      const updated = await rows(this.db, sql`UPDATE ema_ghl_worker_leases SET expires_at=now()+interval '60 seconds'
        WHERE scope=${scope} AND token=${token} AND expires_at>now() RETURNING token`);
      if (!updated.length) throw new GhlFailure("LEASE_LOST");
    };
    try {
      const candidates = await rows(this.db, sql`UPDATE ema_ghl_operations o SET state='running',
        lease_token=${token},lease_until=now()+interval '60 seconds',attempts=attempts+1
        WHERE o.id=(SELECT q.id FROM ema_ghl_operations q
          WHERE q.environment=${environment} AND q.location_id=${locationId}
          AND ${this.config.controlled
            ? sql`q.submission_id IN (${sql.join(this.config.controlled.records.map(r => sql`${r.submissionId}::uuid`), sql`,`)})`
            : sql`true`}
          AND ((q.state IN ('pending','retry') AND q.available_at<=now()) OR (q.state='running' AND q.lease_until<now()))
          AND NOT EXISTS(SELECT 1 FROM ema_ghl_mutation_barriers b WHERE b.scope=${scope} AND b.operation_id<>q.id)
          AND NOT EXISTS(SELECT 1 FROM ema_ghl_operations earlier WHERE earlier.submission_id=q.submission_id
            AND earlier.environment=q.environment AND earlier.location_id=q.location_id
            AND earlier.ordinal<q.ordinal AND earlier.state<>'confirmed')
          ORDER BY q.available_at,q.ordinal LIMIT 1)
        AND ${fenced} RETURNING o.*`);
      op = candidates[0];
      if (!op) return false;
      const [submission] = await rows<Assessment>(this.db, sql`SELECT * FROM ema_assessment_submissions WHERE id=${op.submission_id}`);
      if (!submission?.completed_at) throw new GhlFailure("SUBMISSION_NOT_COMPLETED");
      if (this.config.controlled) assertControlledRecord(this.config.controlled, submission);
      let verifiedContactId: string | undefined;
      const request = async (action: string, method: Method, path: string, body?: Record<string, unknown>) => {
        assertControlledMutation(this.config, submission, method, path, body, verifiedContactId);
        await renew();
        const id = randomUUID();
        await this.db.execute(sql`INSERT INTO ema_ghl_attempts(id,operation_id,action) VALUES(${id},${op.id},${action})`);
        if (method !== "GET") {
          // Persist BEFORE dispatch, so a process death/expired lease leaves the
          // same safety barrier as a timeout. No new owner can mutate another lead.
          await this.db.execute(sql`INSERT INTO ema_ghl_mutation_barriers(scope,operation_id,action)
            VALUES(${scope},${op.id},${action}) ON CONFLICT(scope) DO NOTHING`);
        }
        try {
          const response = await this.client.request(method, path, body);
          if (this.config.controlled && method === "GET" && !path.startsWith("/contacts/search/") && response.body?.contact) {
            const c = response.body.contact;
            const owner = c.customFields?.find((f: any) => f.id === this.config.fieldIds["contact.ema_lead_id"])?.value;
            if (owner !== submission.lead_id || c.locationId !== this.config.locationId ||
              c.email?.toLowerCase() !== submission.answers.email)
              throw new GhlFailure("CONTROLLED_REMOTE_OWNERSHIP_CONFLICT");
            verifiedContactId = c.id;
          }
          await renew();
          await this.db.execute(sql`UPDATE ema_ghl_attempts SET finished_at=now(),outcome='success',http_status=${response.status} WHERE id=${id} AND ${fenced}`);
          if (method !== "GET") await this.db.execute(sql`DELETE FROM ema_ghl_mutation_barriers
            WHERE scope=${scope} AND operation_id=${op.id} AND ${fenced}`);
          return response.body;
        } catch (error) {
          const e = error instanceof GhlFailure ? error : new GhlFailure("AMBIGUOUS_TRANSPORT");
          await this.db.execute(sql`UPDATE ema_ghl_attempts SET finished_at=now(),outcome='error',
            error_code=${e.code},http_status=${e.status ?? null} WHERE id=${id} AND ${fenced}`);
          // Explicit client/auth/rate-limit rejection is not an in-flight write.
           if (method !== "GET" && e.status && e.status >= 400 && e.status < 500 && e.status !== 408)
            await this.db.execute(sql`DELETE FROM ema_ghl_mutation_barriers WHERE scope=${scope} AND operation_id=${op.id} AND ${fenced}`);
          throw e;
        }
      };
      const ambiguous = async (action: string) => (await rows(this.db, sql`SELECT id FROM ema_ghl_attempts
        WHERE operation_id=${op.id} AND action=${action}
         AND (outcome IN ('started','success') OR error_code IN ('AMBIGUOUS_TRANSPORT','INVALID_REMOTE_RESPONSE') OR http_status>=500) LIMIT 1`)).length > 0;
      const result = await this.perform(op.kind, submission, request, ambiguous);
      await renew();
      if (result.contactId || result.opportunityId) {
        await this.db.execute(sql`INSERT INTO ema_ghl_links(environment,location_id,lead_id,contact_id,opportunity_id,latest_completed_at)
          SELECT ${environment},${locationId},${submission.lead_id},${result.contactId ?? null},${result.opportunityId ?? null},
          ${result.latest ?? null}::timestamptz WHERE ${fenced}
          ON CONFLICT(environment,location_id,lead_id) DO UPDATE SET
            contact_id=COALESCE(excluded.contact_id,ema_ghl_links.contact_id),
            opportunity_id=COALESCE(excluded.opportunity_id,ema_ghl_links.opportunity_id),
            latest_completed_at=GREATEST(excluded.latest_completed_at,ema_ghl_links.latest_completed_at)`);
      }
      await this.db.execute(sql`UPDATE ema_ghl_operations SET state='confirmed',confirmed_at=now(),lease_until=NULL,
        result=${JSON.stringify(result)}::jsonb,remote_id=${result.remoteId ?? null},error_code=NULL
        WHERE id=${op.id} AND lease_token=${token} AND ${fenced}`);
      await this.db.execute(sql`DELETE FROM ema_ghl_mutation_barriers WHERE scope=${scope} AND operation_id=${op.id} AND ${fenced}`);
      return true;
    } catch (error) {
      const e = error instanceof GhlFailure ? error : new GhlFailure(
        error instanceof Error && error.message === "HISTORY_SIZE_REVIEW_REQUIRED" ? error.message : "INTERNAL_DELIVERY_ERROR");
      if (op) {
        const permanent = e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404 || e.code.endsWith("_REQUIRED");
        const state = reviewCodes.has(e.code) || e.code.startsWith("CONTROLLED_") || op.attempts >= 8 ? "review" : permanent ? "blocked" : "retry";
        const delay = Math.max(e.retryAfterMs ?? 0, Math.min(3_600_000, 1000 * 2 ** Math.min(op.attempts, 12)) + Math.floor(Math.random() * 1000));
        await this.db.execute(sql`UPDATE ema_ghl_operations SET state=${state},error_code=${e.code},
          available_at=now()+${delay}*interval '1 millisecond',lease_until=NULL
          WHERE id=${op.id} AND lease_token=${token} AND ${fenced}`);
      }
      return !!op;
    } finally {
      await this.db.execute(sql`DELETE FROM ema_ghl_worker_leases WHERE scope=${scope} AND token=${token}`);
    }
  }
  private async perform(
    kind: OperationKind, s: Assessment,
    call: (action: string, method: Method, path: string, body?: Record<string, unknown>) => Promise<any>,
    ambiguous: (action: string) => Promise<boolean>,
  ): Promise<any> {
    const c = this.config, loc = encode(c.locationId);
    const [link] = await rows(this.db, sql`SELECT * FROM ema_ghl_links WHERE environment=${c.environment} AND location_id=${c.locationId} AND lead_id=${s.lead_id}`);
    const saved = async (name: string) => {
      const [row] = await rows(this.db, sql`SELECT result FROM ema_ghl_operations WHERE submission_id=${s.id}
        AND environment=${c.environment} AND location_id=${c.locationId} AND kind=${name}`);
      return row?.result;
    };
    const contactId = link?.contact_id;
    const idFor = (key: string, model = "contact") => {
      const id = c.fieldIds[`${model}.${key}`];
      if (!id) throw new GhlFailure("FIELD_MAPPING_REQUIRED");
      return id;
    };
    const getContact = async (id: string) => {
      const result = (await call("contact.get", "GET", `/contacts/${encode(id)}`)).contact;
      if (!result || result.id !== id || result.locationId !== c.locationId) throw new GhlFailure("REMOTE_IDENTITY_MISMATCH");
      return result;
    };
    // Every operation must re-establish remote ownership, including note and
    // opportunity operations which ordinarily use persisted local links.
    if (c.controlled && contactId) await getContact(contactId);
    if (kind === "contact") {
      const standard = standardValues(s), values = customValues(s);
      let fields = Object.entries(values).map(([key, fieldValue]) => ({ id: idFor(key), fieldValue }));
      const barrier = await rows(this.db, sql`SELECT action FROM ema_ghl_mutation_barriers WHERE scope=${`${c.environment}:${c.locationId}`}`);
      if (barrier.some(b => b.action === "contact.update")) throw new GhlFailure("UNRESOLVED_UPDATE_REVIEW");
      let remote = contactId ? await getContact(contactId) : undefined;
      // Independently check BOTH identities, even if a link exists.
      const matches = new Set<string>();
      for (const [key, value] of [["email", standard.email], ["number", standard.phone]]) {
        if (!value) continue;
        const found = (await call(`contact.search.${key}`, "GET", `/contacts/search/duplicate?locationId=${loc}&${key}=${encode(value)}`)).contact;
        if (found) {
          if (!found.id || found.locationId !== c.locationId) throw new GhlFailure("REMOTE_IDENTITY_MISMATCH");
          matches.add(found.id);
        }
      }
      if (matches.size > 1 || (remote && [...matches].some(id => id !== remote.id))) throw new GhlFailure("IDENTITY_CONFLICT");
      if (!remote && matches.size) remote = await getContact([...matches][0]);
      const dateId = idFor("ema_latest_completed_at");
      if (remote) {
        fields = fields.filter(f => {
          const key = Object.keys(values).find(key => idFor(key) === f.id)!;
          const existing = fieldValue(remote, f.id);
          return !firstTouchKeys.has(key) || existing === undefined || existing === null || existing === "";
        });
        const newer = fieldValue(remote, dateId);
        const localNewer = link?.latest_completed_at;
        if ((newer && new Date(newer).getTime() > new Date(s.completed_at).getTime()) ||
          (localNewer && new Date(localNewer).getTime() > new Date(s.completed_at).getTime())) {
          return { contactId: remote.id, remoteId: remote.id, skippedNewer: true };
        }
        if (await ambiguous("contact.create")) {
          // The original create may have succeeded. Reconcile read-only and do
          // not issue a second mutation while its outcome remains uncertain.
          if (Object.entries(standard).some(([key, value]) => !same(remote[key], value)) ||
            fields.some(f => !same(fieldValue(remote, f.id), f.fieldValue))) throw new GhlFailure("AMBIGUOUS_CREATE");
        } else {
          await call("contact.update", "PUT", `/contacts/${encode(remote.id)}`, { ...standard, customFields: fields });
        }
      } else {
        if (!standard.email && !standard.phone) throw new GhlFailure("CONTACT_IDENTITY_REQUIRED");
        if (await ambiguous("contact.create")) throw new GhlFailure("AMBIGUOUS_CREATE");
        // Controlled live tests must never upsert a contact that appeared after
        // preflight. Create-only fails on a duplicate rather than updating it.
        const created = await call("contact.create", "POST", c.controlled ? "/contacts/" : "/contacts/upsert", { ...standard, locationId: c.locationId, customFields: fields });
        remote = created.contact;
        if (!remote?.id) throw new GhlFailure("AMBIGUOUS_CREATE");
      }
      return { contactId: remote.id, remoteId: remote.id, expected: { standard, fields }, latest: new Date(s.completed_at).toISOString() };
    }
    if (!contactId) throw new GhlFailure("CONTACT_LINK_REQUIRED");
    if (kind === "contact_verify") {
      const previous = await saved("contact");
      const contact = await getContact(contactId);
      if (!previous.skippedNewer) {
        const latestAt = fieldValue(contact, idFor("ema_latest_completed_at"));
        const latestId = fieldValue(contact, idFor("ema_latest_submission_id"));
        if (latestAt && latestId && latestId !== s.id && new Date(latestAt).getTime() > new Date(s.completed_at).getTime())
          return { remoteId: contactId, superseded: true };
        const { standard, fields } = previous.expected;
        if (Object.entries(standard).some(([key, value]) => !same(contact[key], value)) ||
            fields.some((f: any) => !same(fieldValue(contact, f.id), f.fieldValue))) throw new GhlFailure("READBACK_MISMATCH");
      }
      return { remoteId: contactId };
    }
    if (kind === "history") {
      await getContact(contactId);
      const body = historyBody(s), marker = `[ema-submission:${s.id}]`;
      const notes = (await call("note.list", "GET", `/contacts/${encode(contactId)}/notes`)).notes;
      if (!Array.isArray(notes)) throw new GhlFailure("READBACK_MISMATCH");
      const found = notes.filter((note: any) => typeof note.body === "string" && note.body.includes(marker));
      if (found.length > 1) throw new GhlFailure("MULTIPLE_REMOTE_MATCHES");
      if (found.length) {
        if (found[0].body !== body) throw new GhlFailure("READBACK_MISMATCH");
        return { remoteId: found[0].id };
      }
      if (await ambiguous("note.create")) throw new GhlFailure("AMBIGUOUS_CREATE");
      const result = await call("note.create", "POST", `/contacts/${encode(contactId)}/notes`, { body });
      if (!result.note?.id) throw new GhlFailure("AMBIGUOUS_CREATE");
      return { remoteId: result.note.id };
    }
    if (kind === "history_verify") {
      const previous = await saved("history");
      const note = (await call("note.get", "GET", `/contacts/${encode(contactId)}/notes/${encode(previous.remoteId)}`)).note;
      if (!note || note.id !== previous.remoteId || note.contactId !== contactId || note.body !== historyBody(s)) throw new GhlFailure("READBACK_MISMATCH");
      return { remoteId: note.id };
    }
    if (!c.pipelineId || !c.stageId) throw new GhlFailure("PIPELINE_STAGE_REQUIRED");
    const leadField = idFor("ema_lead_id", "opportunity");
    if (kind === "opportunity") {
      if (link?.opportunity_id) return { remoteId: link.opportunity_id, opportunityId: link.opportunity_id };
      const marker = `[ema-lead:${s.lead_id}]`;
      // Enumerate all opportunities for this contact. Never silently adopt an unmarked one.
      const all: any[] = [];
      for (let page = 1; page <= 100; page++) {
        const result = await call("opportunity.search", "GET", `/opportunities/search?locationId=${loc}&contactId=${encode(contactId)}&limit=100&page=${page}`);
        if (!Array.isArray(result.opportunities)) throw new GhlFailure("READBACK_MISMATCH");
        all.push(...result.opportunities);
        if (result.opportunities.length < 100 && !result.meta?.nextPage) break;
        if (page === 100) throw new GhlFailure("PAGINATION_REVIEW_REQUIRED");
      }
      const matching = all.filter(o => o.name?.includes(marker) && opportunityValue(o, leadField) === s.lead_id);
      if (matching.length > 1) throw new GhlFailure("MULTIPLE_REMOTE_MATCHES");
      if (matching.length === 1) return { remoteId: matching[0].id, opportunityId: matching[0].id };
      if (all.length) throw new GhlFailure("OPPORTUNITY_OWNERSHIP_REVIEW");
      if (await ambiguous("opportunity.create")) throw new GhlFailure("AMBIGUOUS_CREATE");
      const result = await call("opportunity.create", "POST", "/opportunities/", {
        locationId: c.locationId, contactId, pipelineId: c.pipelineId, pipelineStageId: c.stageId,
        name: `EMA ${s.answers.referenceNumber} ${marker}`, status: "open",
        customFields: [{ id: leadField, fieldValue: s.lead_id }, { id: idFor("ema_reference", "opportunity"), fieldValue: s.answers.referenceNumber }],
      });
      if (!result.opportunity?.id) throw new GhlFailure("AMBIGUOUS_CREATE");
      return { remoteId: result.opportunity.id, opportunityId: result.opportunity.id };
    }
    const previous = await saved("opportunity");
    const o = (await call("opportunity.get", "GET", `/opportunities/${encode(previous.remoteId)}`)).opportunity;
    if (!o || o.id !== previous.remoteId || o.locationId !== c.locationId || o.contactId !== contactId ||
      o.pipelineId !== c.pipelineId || opportunityValue(o, leadField) !== s.lead_id) throw new GhlFailure("READBACK_MISMATCH");
    // Deliberately do not reset stage/status: the sales team may already have progressed it.
    return { remoteId: o.id };
  }
}

export async function submissionDeliveryState(db: Executor, submissionId: string, config: GhlConfig) {
  const result = await rows(db, sql`SELECT state FROM ema_ghl_operations WHERE submission_id=${submissionId}
    AND environment=${config.environment} AND location_id=${config.locationId}`);
  return result.length === 6 && result.every(r => r.state === "confirmed") ? "synced" :
    result.some(r => r.state === "review" || r.state === "blocked") ? "needs_attention" : "pending";
}