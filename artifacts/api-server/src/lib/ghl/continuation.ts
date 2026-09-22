import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { GhlFailure, type GhlConfig } from "./config";
import type { GhlClient } from "./client";
import type { Executor } from "./snapshots";
import { customValues, historyBody, standardValues, standardReadbackMatches } from "./fields";
import { recoveryFixtures, recoveryContactId, type RecoveryRecords } from "./recovery";

export const continuationPins = {
  status: "19274da1393d40bed653263661451ef823c714bb063b8ae4b192220e2d46f75e",
  journal: "dd75751d250a06186fdadad66c59f808ccf8f846f0b98a0a921ceb735c4e35cd",
};
export const diagnosticRetryPins = {
  status: "480d7d9f0de7e0aa05badc794d1d98852237243d69871d4a41a6151f1904f9aa",
  journal: "4dfe9e3beb7ea80b35b39d2232d84d2bb6374fe06609bacb9e8cafd557d570bb",
};
export const failedReadOperation = "8785bfde-b707-4592-9b56-bdd27ac24f03";
export const recordedNoteIds = ["X36T437aqSAO8STEILpU", "6ihmViey4txszsEwEtnP"];
export const recordedOpportunityId = "HNKMrRj66wKGHw6qqZWC";
export function sha256(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
export function continuationDenied(): never { throw new GhlFailure("CONTROLLED_CONTINUATION_REVIEW_REQUIRED"); }
function canonical(value: any): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const equalState = (a: any, b: any) => canonical(a) === canonical(b);
export async function stateRows(db: Executor, table: string) {
  const allowed = ["ema_ghl_operations", "ema_ghl_attempts", "ema_ghl_links", "ema_assessment_submissions",
    "ema_ghl_mutation_barriers", "ema_ghl_worker_leases"];
  if (!allowed.includes(table)) continuationDenied();
  const result: any = await db.execute(sql.raw(`SELECT * FROM ${table}`));
  return (result.rows ?? result) as any[];
}
export type ContinuationEvidence = { original: RecoveryRecords; status: string; journal: string };
/** Requires actual restored database rows, never rebuilds or infers confirmations. */
export async function validateContinuationState(db: Executor, config: GhlConfig, evidence: ContinuationEvidence) {
  const pins = { status: sha256(evidence.status), journal: sha256(evidence.journal) };
  const diagnosticRetry = pins.status === diagnosticRetryPins.status && pins.journal === diagnosticRetryPins.journal;
  if (!diagnosticRetry && (pins.status !== continuationPins.status || pins.journal !== continuationPins.journal))
    continuationDenied();
  const expected = JSON.parse(evidence.status).diagnostics;
  if (diagnosticRetry) {
    const report = JSON.parse(evidence.status);
    const entries = evidence.journal.trim().split("\n").map(line => JSON.parse(line));
    const requests = entries.filter(entry => entry.phase === "request");
    const responses = entries.filter(entry => entry.phase === "response");
    if (report.status !== "stopped-handle-retained" || report.code !== "CONTROLLED_CONTINUATION_REVIEW_REQUIRED" ||
      report.handleRetained !== true || report.automaticRetryAllowed !== false ||
      Object.values(report.liveContinuationWrites ?? {}).some(value => value !== 0) ||
      requests.length !== 14 || responses.length !== 14 ||
      requests.slice(0, -1).some(entry => entry.method !== "GET") ||
      requests.at(-1)?.method !== "POST" || requests.at(-1)?.path !== "/opportunities/" ||
      responses.at(-1)?.status !== 400 || responses.at(-1)?.id !== requests.at(-1)?.id)
      continuationDenied();
  }
  const fixtures = recoveryFixtures(config, evidence.original);
  const operations = (await stateRows(db, "ema_ghl_operations")).sort((a, b) => a.id.localeCompare(b.id));
  const attempts = (await stateRows(db, "ema_ghl_attempts")).sort((a, b) =>
    new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const projection = operations.map(({ id, submission_id, kind, state, error_code, remote_id, attempts }) =>
    ({ id, submission_id, kind, state, error_code, remote_id, attempts }));
  const attemptProjection = attempts.map(({ operation_id, action, outcome, http_status, error_code }) =>
    ({ operation_id, action, outcome, http_status, error_code }));
  const expectedOperations = [...expected.operations].sort((a: any, b: any) => a.id.localeCompare(b.id));
  if (!equalState(projection, expectedOperations) || !equalState(attemptProjection, expected.attempts) ||
    operations.length !== 18 || operations.filter(o => o.state === "confirmed").length !== 10 ||
    operations.some(o => o.environment !== config.environment || o.location_id !== config.locationId) ||
    (await stateRows(db, "ema_ghl_mutation_barriers")).length ||
    (await stateRows(db, "ema_ghl_worker_leases")).length) continuationDenied();
  const failed = operations.find(o => o.id === failedReadOperation);
  const failedAttempts = attempts.filter(a => a.operation_id === failed?.id);
  if (!failed || failed.kind !== "opportunity" ||
    (!diagnosticRetry && (failed.state !== "retry" || failed.error_code !== "INVALID_REMOTE_RESPONSE" ||
      failedAttempts.some(a => a.action !== "contact.get" && a.action !== "opportunity.search"))) ||
    (diagnosticRetry && (failed.state !== "blocked" || failed.error_code !== "REMOTE_REJECTED" ||
      failedAttempts.filter(a => a.action === "opportunity.create" && a.outcome === "error" &&
        a.http_status === 400 && a.error_code === "REMOTE_REJECTED").length !== 1 ||
      failedAttempts.at(-1)?.action !== "opportunity.create")))
    continuationDenied();
  const submissions = await stateRows(db, "ema_assessment_submissions");
  if (submissions.length !== 3) continuationDenied();
  for (const fixture of fixtures) {
    const s = submissions.find(s => s.id === fixture.id);
    if (!s || s.lead_id !== fixture.lead_id || s.flow !== fixture.flow || !equalState(s.answers, fixture.answers) ||
      !equalState(s.attribution, fixture.attribution) || new Date(s.completed_at).toISOString() !== fixture.completed_at)
      continuationDenied();
  }
  const links = await stateRows(db, "ema_ghl_links");
  if (links.length !== 2 || links.some(l => l.environment !== config.environment || l.location_id !== config.locationId ||
    l.contact_id !== recoveryContactId)) continuationDenied();
  for (let i = 0; i < 2; i++) {
    const link = links.find(l => l.lead_id === fixtures[i].lead_id);
    if (!link || link.opportunity_id !== (i === 0 ? recordedOpportunityId : null) ||
      new Date(link.latest_completed_at).toISOString() !== fixtures[i].completed_at) continuationDenied();
  }
  const consumed = new Set<string>();
  for (const attempt of attempts) {
    const op = operations.find(o => o.id === attempt.operation_id);
    if (!op) continuationDenied();
    const key = ({ "contact.update": "update", "note.create": "note", "opportunity.create": "opportunity" } as Record<string, string>)[attempt.action];
    // This exact, explicit HTTP 400 create is the sole user-authorized diagnostic
    // exception. Every successful or ambiguous mutation remains consumed.
    if (key) {
      if (!(diagnosticRetry && op.id === failedReadOperation && attempt.action === "opportunity.create" &&
        attempt.outcome === "error" && attempt.http_status === 400 && attempt.error_code === "REMOTE_REJECTED"))
        consumed.add(`${key}:${op.submission_id}`);
    } else if (!["contact.get", "contact.search.email", "contact.search.number", "note.list", "note.get",
      "opportunity.search", "opportunity.get"].includes(attempt.action)) continuationDenied();
  }
  if (consumed.size !== 4) continuationDenied();
  // JSONB retrieval has provider-visible key order in historyBody's JSON.stringify.
  // Validated restored snapshots—not equivalent reconstructed JS objects—are
  // authoritative for every subsequent serialization.
  const restoredFixtures = fixtures.map(f => submissions.find(s => s.id === f.id)!);
  return { operations, attempts, links, fixtures: restoredFixtures, consumed, diagnosticRetry };
}
export async function reconcileContinuation(db: Executor, config: GhlConfig, client: GhlClient, evidence: ContinuationEvidence) {
  const state = await validateContinuationState(db, config, evidence);
  const latest = state.fixtures[1];
  for (const [key, value] of [["email", latest.answers.email], ["number", latest.answers.phone]]) {
    const response = await client.request("GET", `/contacts/search/duplicate?locationId=${encodeURIComponent(config.locationId)}&${key}=${encodeURIComponent(value)}`);
    if (response.body?.contact?.id !== recoveryContactId || response.body.contact.locationId !== config.locationId) continuationDenied();
  }
  const contact = (await client.request("GET", `/contacts/${recoveryContactId}`)).body?.contact;
  if (!contact || contact.id !== recoveryContactId || contact.locationId !== config.locationId ||
    Object.entries(standardValues(latest)).some(([k, v]) => !standardReadbackMatches(contact, k, v)) ||
    !Array.isArray(contact.customFields)) continuationDenied();
  const expectedValues = { ...customValues(state.fixtures[0]), ...customValues(latest) };
  for (const [key, value] of Object.entries(expectedValues)) {
    const fields = contact.customFields.filter((f: any) => f.id === config.fieldIds[`contact.${key}`]);
    if (fields.length !== 1 || !equalState(fields[0].value, value)) continuationDenied();
  }
  const notes = (await client.request("GET", `/contacts/${recoveryContactId}/notes`)).body;
  if (!Array.isArray(notes?.notes) || notes.notes.length !== 2 || notes.meta?.nextPage) continuationDenied();
  for (let i = 0; i < 2; i++) {
    if (notes.notes.filter((n: any) => n.id === recordedNoteIds[i] && n.body === historyBody(state.fixtures[i])).length !== 1)
      continuationDenied();
    const note = (await client.request("GET", `/contacts/${recoveryContactId}/notes/${recordedNoteIds[i]}`)).body?.note;
    if (!note || note.id !== recordedNoteIds[i] || note.contactId !== recoveryContactId ||
      note.body !== historyBody(state.fixtures[i])) continuationDenied();
  }
  const search = (await client.request("GET", `/opportunities/search?locationId=${encodeURIComponent(config.locationId)}&contactId=${recoveryContactId}&limit=100&page=1`)).body;
  if (!Array.isArray(search?.opportunities) || search.opportunities.length !== 1 || search.meta?.nextPage ||
    (search.meta?.total !== undefined && search.meta.total !== 1)) continuationDenied();
  const single = (await client.request("GET", `/opportunities/${recordedOpportunityId}`)).body?.opportunity;
  for (const o of [search.opportunities[0], single]) {
    if (!o || o.id !== recordedOpportunityId || o.contactId !== recoveryContactId || o.locationId !== config.locationId ||
      o.pipelineId !== config.pipelineId || !Array.isArray(o.customFields)) continuationDenied();
    for (const [key, value] of [["ema_lead_id", state.fixtures[0].lead_id], ["ema_reference", state.fixtures[0].answers.referenceNumber]]) {
      const fields = o.customFields.filter((f: any) => f.id === config.fieldIds[`opportunity.${key}`]);
      if (fields.length !== 1 || fields[0].fieldValue !== value) continuationDenied();
    }
  }
  return state;
}