import { createHash } from "node:crypto";
import { GhlFailure, type GhlConfig } from "./config";
import type { GhlClient } from "./client";
import { customValues, standardValues, standardReadbackMatches, type Assessment } from "./fields";

export const recoveryContactId = "DbmJnLc7qWqwQek67U2n";
export const recoveryLocationId = "5ce9hy8I0qH6fFNBo1cF";
export const recoveryPairs = [
  ["individual", "843b5cf4-456c-46cd-87e5-50f6d9cc1a4f", "2a2f7b63-f30c-4f20-8ceb-4662ff024dcd"],
  ["overstay", "856c18fe-962a-45e2-b457-88ab2f4a20cb", "f0cf5621-8084-4088-9830-4a0f763a0128"],
  ["business", "7eb4be34-7b67-4c28-8dd7-df02cef5fd1a", "6289f8e1-adbc-49a3-844b-50ea6fd98b40"],
] as const;
export type RecoveryRecords = { journal: string; partial: string; status: string };
const hashes = {
  journal: "a03582752dcda8cb9ab71c06541449133373aa9937c84e257bec77abbae89103",
  partial: "941dfa224b9c7465f1aee1af0639f7e6e7f5f4d4aa978e8d0162669a377a21c6",
  status: "f5c74a9c77df253ee88bfd20ff9638f66834530de97ae0e7a790f5869166565d",
};
function deny(): never { throw new GhlFailure("CONTROLLED_RECOVERY_REVIEW_REQUIRED"); }
/** Exact byte-pinned redacted stopped-run evidence, not an operator-supplied
 * success flag. Any changed/extended journal requires a new code review. */
export function recoveryFixtures(config: GhlConfig, recorded: RecoveryRecords): Assessment[] {
  for (const key of Object.keys(hashes) as (keyof RecoveryRecords)[])
    if (createHash("sha256").update(recorded[key]).digest("hex") !== hashes[key]) deny();
  if (config.locationId !== recoveryLocationId || config.controlled?.records.length !== 3) deny();
  const partial = JSON.parse(recorded.partial);
  return recoveryPairs.map(([flow, leadId, submissionId], i) => {
    const record = config.controlled!.records[i];
    if (record.flow !== flow || record.leadId !== leadId || record.submissionId !== submissionId) deny();
    const answers = {
      fullName: "EMA Controlled Test", email: record.email, phone: record.phone, whatsapp: record.phone,
      consentAccepted: true, consentTimestamp: new Date(Date.parse(partial.consentAt) + i).toISOString(), preferredContactMethod: "email",
      referenceNumber: `EMA-CONTROLLED-TEST-${flow}`,
      ...(flow === "individual" ? { immigrationSituation: "visa_required" } :
        flow === "overstay" ? { firstName: "EMA", currentSituation: "unsure_of_status" } :
          { firmName: "EMA Controlled Test Firm", practiceAreas: ["work_visas"], casesLast12mBand: "<25" }),
    };
    return { id: submissionId, lead_id: leadId, flow, answers,
      attribution: { source: "controlled-test", sourceCampaign: "shared-contact-test" },
      // These two later fixture times are reconstruction, NOT recovered state.
      completed_at: new Date(Date.parse(partial.latestCompletedAt) + i).toISOString() };
  });
}
export function assertRecoveryContact(contact: any, config: GhlConfig, first: Assessment) {
  if (!contact || contact.id !== recoveryContactId || contact.locationId !== config.locationId ||
    Object.entries(standardValues(first)).some(([key, value]) => !standardReadbackMatches(contact, key, value)) ||
    !Array.isArray(contact.customFields)) deny();
  for (const [key, value] of Object.entries(customValues(first))) {
    const matches = contact.customFields.filter((f: any) => f.id === config.fieldIds[`contact.${key}`]);
    if (matches.length !== 1 || JSON.stringify(matches[0].value) !== JSON.stringify(value)) deny();
  }
}
/** All reads are fresh; neither missing identity nor an already-started recovery
 * is admissible. This entry point cannot resume ambiguous recovery writes. */
export async function reviewRecovery(config: GhlConfig, client: GhlClient, recorded: RecoveryRecords) {
  const fixtures = recoveryFixtures(config, recorded);
  for (const [key, value] of [["email", fixtures[0].answers.email], ["number", fixtures[0].answers.phone]]) {
    const response = await client.request("GET", `/contacts/search/duplicate?locationId=${encodeURIComponent(config.locationId)}&${key}=${encodeURIComponent(value)}`);
    if (response.body?.contact?.id !== recoveryContactId ||
      response.body.contact.locationId !== config.locationId) deny();
  }
  assertRecoveryContact((await client.request("GET", `/contacts/${recoveryContactId}`)).body?.contact, config, fixtures[0]);
  const notes = (await client.request("GET", `/contacts/${recoveryContactId}/notes`)).body;
  const opportunities = (await client.request("GET", `/opportunities/search?locationId=${encodeURIComponent(config.locationId)}&contactId=${recoveryContactId}&limit=100&page=1`)).body;
  if (!Array.isArray(notes?.notes) || notes.notes.length || notes.meta?.nextPage ||
    !Array.isArray(opportunities?.opportunities) || opportunities.opportunities.length ||
    opportunities.meta?.nextPage || (opportunities.meta?.total !== undefined && opportunities.meta.total !== 0)) deny();
  return fixtures;
}
/** Independent last-line transport allowlist. No contact POST, setup or DELETE
 * can reach the underlying client, even if worker routing regresses. A send is
 * consumed BEFORE dispatch; an ambiguous attempt cannot be resent here. */
export function recoveryClient(inner: GhlClient, config: GhlConfig, consumed: Iterable<string> = []): GhlClient {
  const sent = new Set<string>(consumed);
  return { async request(method, path, body) {
    if (method === "GET") return inner.request(method, path, body);
    const fields = body?.customFields as any[] | undefined;
    const field = (key: string) => fields?.find(f => f.id === config.fieldIds[key])?.fieldValue;
    let operation: string | undefined;
    if (method === "PUT" && path === `/contacts/${recoveryContactId}`) {
      const record = config.controlled?.records.slice(1).find(r =>
        r.submissionId === field("contact.ema_latest_submission_id") && r.leadId === field("contact.ema_lead_id"));
      if (record && body?.email === record.email && body?.phone === record.phone)
        operation = `update:${record.submissionId}`;
    }
    if (method === "POST" && path === `/contacts/${recoveryContactId}/notes`) {
      const record = config.controlled?.records.find(r =>
        typeof body?.body === "string" && body.body.includes(`[ema-submission:${r.submissionId}]`));
      if (record) operation = `note:${record.submissionId}`;
    }
    if (method === "POST" && path === "/opportunities/" && body?.contactId === recoveryContactId &&
      body?.locationId === config.locationId && body?.pipelineId === config.pipelineId &&
      body?.pipelineStageId === config.stageId && body?.status === "open") {
      const record = config.controlled?.records.find(r => r.leadId === field("opportunity.ema_lead_id"));
      if (record) operation = `opportunity:${record.submissionId}`;
    }
    if (!operation || sent.has(operation) || Object.keys(body ?? {}).some(k => /dnd|suppression/i.test(k))) deny();
    sent.add(operation);
    return inner.request(method, path, body);
  } };
}