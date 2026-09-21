import { describe, expect, it, vi } from "vitest";
import { fieldDefinitions } from "./fields";

const location = "controlled-live-location";
const cliPath = process.env.EMA_GHL_TEST_COMPILED === "true"
  ? "../../../dist/ghl-controlled-live.mjs"
  : "../../../scripts/ghl-controlled-live.ts";
const records = [
  { flow: "individual", leadId: "843b5cf4-456c-46cd-87e5-50f6d9cc1a4f", submissionId: "2a2f7b63-f30c-4f20-8ceb-4662ff024dcd" },
  { flow: "overstay", leadId: "856c18fe-962a-45e2-b457-88ab2f4a20cb", submissionId: "f0cf5621-8084-4088-9830-4a0f763a0128" },
  { flow: "business", leadId: "7eb4be34-7b67-4c28-8dd7-df02cef5fd1a", submissionId: "6289f8e1-adbc-49a3-844b-50ea6fd98b40" },
] as const;
const fieldIds = Object.fromEntries(fieldDefinitions.map(field =>
  [`${field.model}.${field.key}`, `${field.model}-${field.key}`]));

function environment(overrides: Record<string, string> = {}) {
  const manifest = {
    locationId: location,
    records: records.map(record => ({
      ...record,
      email: "controlled@example.invalid",
      phone: "+27820000000",
    })),
  };
  return {
    NODE_ENV: "test",
    EMA_GHL_DELIVERY_ENABLED: "true",
    EMA_GHL_DELIVERY_MODE: "controlled-live",
    EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID: location,
    EMA_GHL_CONTROLLED_LIVE_APPROVAL: "ALLOW_THREE_SYNTHETIC_RECORDS_IN_LIVE_ACCOUNT",
    EMA_GHL_CONTROLLED_MANIFEST_JSON: JSON.stringify(manifest),
    GHL_LOCATION_ID: location,
    EMA_GHL_PIPELINE_ID: "pipeline",
    EMA_GHL_STAGE_ID: "new-lead",
    EMA_GHL_FIELD_IDS_JSON: JSON.stringify(fieldIds),
    GHL_PRIVATE_INTEGRATION_TOKEN: "intercepted-only",
    ...overrides,
  };
}

function evidence(now: number) {
  return JSON.stringify({
    version: 1,
    locationId: location,
    reviewedAt: new Date(now).toISOString(),
    statement: "REACHABLE_AUTOMATIONS_REVIEWED_OTHER_RECIPIENTS_EXCLUDED_DND_PRESERVED",
    reachableAutomationsReviewed: true,
    otherRecipientsExcluded: true,
    boundedIdentityOnly: true,
    suppressionAndDndPreserved: true,
  });
}

describe("controlled-live release CLI", () => {
  it("is network, environment, evidence-file and database inert by default", async () => {
    const { runControlledLive } = await import(cliPath);
    const transport = vi.fn();
    const readFile = vi.fn();
    const result = await runControlledLive([], {
      env: new Proxy({}, { get: () => { throw new Error("ENV_READ"); } }),
      fetch: transport,
      readFile,
    });
    expect(result.mode).toBe("dry-run");
    expect(result.networkCalls).toBe(0);
    expect(transport).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects any replacement UUID before intercepted transport", async () => {
    const { runControlledLive } = await import(cliPath);
    const now = Date.now();
    const env = environment();
    const parsed = JSON.parse(env.EMA_GHL_CONTROLLED_MANIFEST_JSON);
    parsed.records[0].leadId = "943b5cf4-456c-46cd-87e5-50f6d9cc1a4f";
    env.EMA_GHL_CONTROLLED_MANIFEST_JSON = JSON.stringify(parsed);
    const transport = vi.fn();
    await expect(runControlledLive(
      ["--execute", "--approve-location", location, "--recipient-evidence", "/secure/evidence.json"],
      { env, fetch: transport, now: () => now, readFile: async () => evidence(now) },
    )).rejects.toThrow("APPROVED_MANIFEST_REQUIRED");
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses isolated PGlite, intercepted provider readbacks, and a no-op replay", async () => {
    const { runControlledLive } = await import(cliPath);
    const now = Date.now();
    const contacts: any[] = [], notes: any[] = [], opportunities: any[] = [];
    const mutations: string[] = [];
    const transport: typeof fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method !== "GET") mutations.push(`${method} ${url.pathname}`);
      let output: any;
      if (url.pathname === `/locations/${location}/customFields`) {
        const model = url.searchParams.get("model");
        output = { customFields: fieldDefinitions.filter(field => field.model === model).map(field => ({
          id: fieldIds[`${field.model}.${field.key}`],
          name: field.name,
          fieldKey: `${field.model}.${field.key}`,
          dataType: field.dataType,
          model: field.model,
          ...(field.options ? { options: field.options } : {}),
        })) };
      } else if (url.pathname === "/opportunities/pipelines") {
        output = { pipelines: [{ id: "pipeline", stages: [{ id: "new-lead" }] }] };
      } else if (url.pathname === "/contacts/search/duplicate") {
        output = { contact: contacts.find(contact =>
          contact.email === url.searchParams.get("email") ||
          contact.phone === url.searchParams.get("number")) ?? null };
      } else if (url.pathname === "/contacts/" && method === "POST") {
        const contact = {
          ...body,
          id: "controlled-contact",
          dnd: true,
          dndSettings: { Email: { status: "active" }, SMS: { status: "active" } },
          tags: ["preexisting-suppression"],
          customFields: body.customFields.map((field: any) => ({ id: field.id, value: field.fieldValue })),
        };
        contacts.push(contact);
        output = { contact };
      } else if (/^\/contacts\/[^/]+$/.test(url.pathname)) {
        const contact = contacts.find(item => item.id === url.pathname.split("/")[2]);
        if (method === "PUT") {
          const fields = new Map(contact.customFields.map((field: any) => [field.id, field]));
          for (const field of body.customFields)
            fields.set(field.id, { id: field.id, value: field.fieldValue });
          Object.assign(contact, body, { customFields: [...fields.values()] });
        }
        output = { contact };
      } else if (/\/notes$/.test(url.pathname)) {
        const contactId = url.pathname.split("/")[2];
        if (method === "POST") {
          const note = { id: `note-${notes.length}`, contactId, body: body.body };
          notes.push(note);
          output = { note };
        } else output = { notes: notes.filter(note => note.contactId === contactId) };
      } else if (url.pathname.includes("/notes/")) {
        output = { note: notes.find(note => note.id === url.pathname.split("/")[4]) };
      } else if (url.pathname === "/opportunities/search") {
        output = { opportunities: opportunities.filter(item =>
          item.contactId === url.searchParams.get("contactId")) };
      } else if (url.pathname === "/opportunities/" && method === "POST") {
        const opportunity = { ...body, id: `opportunity-${opportunities.length}` };
        opportunities.push(opportunity);
        output = { opportunity };
      } else if (url.pathname.startsWith("/opportunities/")) {
        output = { opportunity: opportunities.find(item => item.id === url.pathname.split("/")[2]) };
      } else throw new Error(`UNEXPECTED_INTERCEPTED_ROUTE:${method}:${url.pathname}`);
      return new Response(JSON.stringify(output), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await runControlledLive(
      ["--execute", "--approve-location", location, "--recipient-evidence", "/secure/evidence.json"],
      { env: environment(), fetch: transport, now: () => now, readFile: async () => evidence(now) },
    );

    expect(result).toMatchObject({
      mode: "executed",
      locationId: location,
      pipelineId: "pipeline",
      stageId: "new-lead",
      completedAt: new Date(now).toISOString(),
      databaseIsolation: "fresh-in-memory-pglite-no-network-database",
      providerTransport: "live-ghl-http",
      operationsConfirmed: 18,
      providerReadback: { contacts: 1, notes: 3, opportunities: 3 },
      providerIds: {
        contactId: "controlled-contact",
        opportunityIds: ["opportunity-0", "opportunity-1", "opportunity-2"],
      },
      replay: "no-op-verified",
      piiIncluded: false,
    });
    expect(result.fieldMappingSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(contacts).toHaveLength(1);
    expect(notes).toHaveLength(3);
    expect(opportunities).toHaveLength(3);
    expect(mutations.filter(call => call === "POST /contacts/")).toHaveLength(1);
    expect(mutations.filter(call => call.includes("/notes"))).toHaveLength(3);
    expect(mutations.filter(call => call === "POST /opportunities/")).toHaveLength(3);
    expect(mutations.some(call => call.includes("upsert"))).toBe(false);
    expect(contacts[0]).toMatchObject({
      dnd: true,
      dndSettings: { Email: { status: "active" }, SMS: { status: "active" } },
      tags: ["preexisting-suppression"],
    });
    const contactValue = (key: string) => contacts[0].customFields.find((field: any) =>
      field.id === fieldIds[`contact.${key}`])?.value;
    expect(contactValue("ema_immigration_situation")).toBe("visa_required");
    expect(contactValue("ema_overstay_situation")).toBe("unsure_of_status");
    expect(contactValue("ema_practice_areas")).toEqual(["work_visas"]);
    expect(contactValue("ema_annual_case_volume_band")).toBe("<25");
    expect(notes.some(note => note.body.includes('"immigrationSituation": "visa_required"'))).toBe(true);
    expect(notes.some(note => note.body.includes('"currentSituation": "unsure_of_status"'))).toBe(true);
    expect(notes.some(note => note.body.includes('"firmName": "EMA Controlled Test Firm"') &&
      note.body.includes('"practiceAreas": [') && note.body.includes('"casesLast12mBand": "<25"'))).toBe(true);
  }, 30_000);
});