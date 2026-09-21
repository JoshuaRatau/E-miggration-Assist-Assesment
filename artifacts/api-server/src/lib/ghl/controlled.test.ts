import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { deliveryConfig, type GhlConfig } from "./config";
import { fieldDefinitions } from "./fields";
import { HttpGhlClient, MockGhlClient } from "./client";
import { GhlWorker } from "./worker";
import { startGhlDelivery } from "./runtime";
import { assertControlledMutation, assertControlledRecord, assertIsolatedControlledDatabase,
  createControlledDatabase, parseControlledManifest, preflightControlled, requireControlledPreflight,
  saveControlledFixture, finalizeControlledFixture } from "./controlled";
const location = "controlled-live-location";
function manifest() {
  return { locationId: location, records: (["individual", "overstay", "business"] as const).map((flow, i) =>
    ({ flow, leadId: randomUUID(), submissionId: randomUUID(), email: `${flow}@controlled.invalid`, phone: `+2782000000${i}` })) };
}
function configuration(): GhlConfig {
  return { environment: "test", locationId: location, pipelineId: "pipeline", stageId: "new-lead",
    fieldIds: Object.fromEntries(fieldDefinitions.map(f => [`${f.model}.${f.key}`, `${f.model}-${f.key}`])), controlled: manifest() };
}
const noMatches = () => new MockGhlClient(async () => ({ status: 200, body: { contact: null } }));
function env(config: GhlConfig) {
  return { NODE_ENV: "test", EMA_GHL_DELIVERY_MODE: "controlled-live", EMA_GHL_DELIVERY_ENABLED: "true",
    EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID: location,
    EMA_GHL_CONTROLLED_LIVE_APPROVAL: "ALLOW_THREE_SYNTHETIC_RECORDS_IN_LIVE_ACCOUNT",
    EMA_GHL_CONTROLLED_MANIFEST_JSON: JSON.stringify(config.controlled), GHL_LOCATION_ID: location,
    EMA_GHL_PIPELINE_ID: "pipeline", EMA_GHL_STAGE_ID: "new-lead", EMA_GHL_FIELD_IDS_JSON: JSON.stringify(config.fieldIds),
    GHL_PRIVATE_INTEGRATION_TOKEN: "intercepted-test-only" };
}
describe("controlled LIVE-account preparation; no actual GHL calls", () => {
  it("requires exactly three unique lead/submission identities and one of each flow", () => {
    const m = manifest();
    expect(parseControlledManifest(JSON.stringify(m), location)).toEqual(m);
    for (const records of [m.records.slice(0, 2), [...m.records, m.records[0]], [m.records[0], m.records[0], m.records[2]]])
      expect(() => parseControlledManifest(JSON.stringify({ ...m, records }), location)).toThrow();
    m.records[1].phone = m.records[0].phone;
    expect(() => parseControlledManifest(JSON.stringify(m), location)).toThrow("CONTROLLED_IDENTITIES_NOT_UNIQUE");
  });
  it("requires explicit LIVE acknowledgement and exact destination without pretending separate account", () => {
    const e = env(configuration());
    expect(deliveryConfig(e).controlled).toBeDefined();
    expect(() => deliveryConfig({ ...e, EMA_GHL_CONTROLLED_LIVE_APPROVAL: "" })).toThrow("CONTROLLED_LIVE_APPROVAL_REQUIRED");
    expect(() => deliveryConfig({ ...e, EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID: "other" })).toThrow();
  });
  it("disabled runtime does not read credentials, database or network", async () => {
    const load = vi.fn(), fetch = vi.fn();
    const result = await startGhlDelivery({ env: { EMA_GHL_DELIVERY_ENABLED: "false" }, loadDatabase: load, fetch });
    expect(result.enabled).toBe(false); expect(load).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("ordinary app runtime cannot use application DB for controlled mode", async () => {
    const load = vi.fn(), fetch = vi.fn();
    await expect(startGhlDelivery({ env: env(configuration()), loadDatabase: load, fetch })).rejects.toThrow("CONTROLLED_ISOLATED_DATABASE_REQUIRED");
    expect(load).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(() => assertIsolatedControlledDatabase({ execute: vi.fn() })).toThrow();
  });
  it("preflights all six identities with GET only, binds receipt to immutable manifest and expires", async () => {
    const config = configuration(), calls: any[] = [];
    const client = new MockGhlClient(async r => { calls.push(r); return { status: 200, body: { contact: null } }; });
    await preflightControlled(config, client);
    expect(calls).toHaveLength(6); expect(calls.every(r => r.method === "GET")).toBe(true);
    expect(calls[0].path).toContain("&email="); expect(calls[1].path).toContain("&number=");
    expect(() => requireControlledPreflight(config)).not.toThrow();
    config.controlled!.records[0].email = "other@controlled.invalid";
    expect(() => requireControlledPreflight(config)).toThrow("CONTROLLED_PREFLIGHT_REQUIRED");
    await preflightControlled(config, client);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    expect(() => requireControlledPreflight(config)).toThrow("CONTROLLED_PREFLIGHT_REQUIRED"); now.mockRestore();
  });
  it.each([{ contact: { id: "existing" } }, {}, { contact: undefined }])("blocks collisions or uncertain matches", async body => {
    const config = configuration();
    await expect(preflightControlled(config, new MockGhlClient(async () => ({ status: 200, body })))).rejects.toThrow();
    expect(() => requireControlledPreflight(config)).toThrow();
  });
  it("rejects changed contact identities and arbitrary notes/opportunities before transport", async () => {
    const config = configuration(), r = config.controlled!.records[0];
    await preflightControlled(config, noMatches());
    const s = { id: r.submissionId, lead_id: r.leadId, flow: r.flow, answers: { email: r.email, whatsapp: r.phone, consentAccepted: true }, attribution: {}, completed_at: new Date() };
    expect(() => assertControlledRecord(config.controlled!, { ...s, answers: { ...s.answers, email: "other@controlled.invalid" } })).toThrow();
    expect(() => assertControlledMutation(config, s, "POST", "/contacts/unrelated/notes", { body: `[ema-submission:${s.id}]` }, "owned")).toThrow();
    expect(() => assertControlledMutation(config, s, "PUT", "/opportunities/unrelated", {}, "owned")).toThrow();
    expect(() => assertControlledMutation(config, s, "POST", "/locations/other/customFields", {}, "owned")).toThrow();
  });
  it("isolated save/finalisation is atomic and nonallowlisted operations remain untouched", async () => {
    const isolated = await createControlledDatabase();
    try {
      expect(isolated.isolation).toBe("fresh-in-memory-no-network");
      expect(isolated.pg.dataDir).toBeUndefined();
      const config = configuration();
      for (const r of config.controlled!.records)
        await saveControlledFixture(isolated.db, config, r.submissionId,
          { email: r.email, whatsapp: r.phone, consentAccepted: true, fullName: "Synthetic Controlled Test" }, { source: "controlled-test" });
      let operations = await isolated.pg.query("SELECT * FROM ema_ghl_operations");
      expect(operations.rows).toHaveLength(12);
      await finalizeControlledFixture(isolated.db, config, config.controlled!.records[0].submissionId);
      await finalizeControlledFixture(isolated.db, config, config.controlled!.records[0].submissionId);
      operations = await isolated.pg.query("SELECT * FROM ema_ghl_operations");
      expect(operations.rows).toHaveLength(18);
      await expect(saveControlledFixture(isolated.db, config, randomUUID(), {}, {})).rejects.toThrow();
      await expect(saveControlledFixture(isolated.db, config, config.controlled!.records[1].submissionId,
        { email: "wrong@controlled.invalid", whatsapp: config.controlled!.records[1].phone, consentAccepted: true }, {})).rejects.toThrow();
      expect((await isolated.pg.query("SELECT * FROM prelaunch_leads")).rows).toHaveLength(3);
      const unlisted = randomUUID(), unlistedSubmission = randomUUID(), unlistedOperation = randomUUID();
      await isolated.db.execute(sql`INSERT INTO prelaunch_leads(id,reference_number) VALUES(${unlisted},'nonallowlisted')`);
      await isolated.db.execute(sql`INSERT INTO ema_assessment_submissions(id,lead_id,flow,answers,attribution,completed_at)
        VALUES(${unlistedSubmission},${unlisted},'individual','{}','{}',now())`);
      await isolated.db.execute(sql`INSERT INTO ema_ghl_operations(id,submission_id,environment,location_id,kind,ordinal,available_at)
        VALUES(${unlistedOperation},${unlistedSubmission},'test',${location},'contact',0,now()-interval '1 day')`);
      await preflightControlled(config, noMatches());
      const worker = new GhlWorker(isolated.db, noMatches(), config);
      await worker.tick();
      const untouched: any = (await isolated.pg.query("SELECT * FROM ema_ghl_operations WHERE id=$1", [unlistedOperation])).rows[0];
      expect(untouched.state).toBe("pending"); expect(untouched.attempts).toBe(0);
      // Mutation of an allowlisted answer after capture is rejected by the actual trigger.
      await expect(isolated.db.execute(sql`UPDATE ema_assessment_submissions SET answers='{}' WHERE id=${config.controlled!.records[0].submissionId}`)).rejects.toThrow();
    } finally { await isolated.close(); }
  }, 30000);
  it("delivers exactly three records via intercepted real HTTP; replay creates nothing", async () => {
    const isolated = await createControlledDatabase(), config = configuration();
    const contacts: any[] = [], notes: any[] = [], opportunities: any[] = [], mutations: string[] = [];
    const transport: typeof fetch = vi.fn(async (input, init) => {
      const u = new URL(String(input)), p = u.pathname, method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method !== "GET") mutations.push(`${method} ${p}`);
      let output: any;
      if (p === "/contacts/search/duplicate") output = { contact: contacts.find(c =>
        c.email === u.searchParams.get("email") || c.phone === u.searchParams.get("number")) ?? null };
      else if (p === "/contacts/" && method === "POST") {
        const contact = { ...body, id: `contact-${contacts.length}`, customFields: body.customFields.map((f: any) => ({ id: f.id, value: f.fieldValue })) };
        contacts.push(contact); output = { contact };
      } else if (/^\/contacts\/[^/]+$/.test(p)) output = { contact: contacts.find(c => c.id === p.split("/")[2]) };
      else if (/\/notes$/.test(p)) {
        const contactId = p.split("/")[2];
        if (method === "POST") { const note = { id: `note-${notes.length}`, contactId, body: body.body }; notes.push(note); output = { note }; }
        else output = { notes: notes.filter(n => n.contactId === contactId) };
      } else if (p.includes("/notes/")) output = { note: notes.find(n => n.id === p.split("/")[4]) };
      else if (p === "/opportunities/search") output = { opportunities: opportunities.filter(o => o.contactId === u.searchParams.get("contactId")) };
      else if (p === "/opportunities/" && method === "POST") { const opportunity = { ...body, id: `opportunity-${opportunities.length}` }; opportunities.push(opportunity); output = { opportunity }; }
      else if (p.startsWith("/opportunities/")) output = { opportunity: opportunities.find(o => o.id === p.split("/")[2]) };
      else throw new Error("UNEXPECTED_INTERCEPTED_ROUTE");
      return new Response(JSON.stringify(output), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new HttpGhlClient({ enabled: true, allowWrites: true, environment: "test", locationId: location,
      approvedLocationId: location, getToken: () => "intercepted-only", fetch: transport });
    try {
      for (const r of config.controlled!.records) {
        await saveControlledFixture(isolated.db, config, r.submissionId,
          { email: r.email, whatsapp: r.phone, consentAccepted: true, fullName: "Synthetic Controlled", firstName: "Synthetic",
            ...(r.flow === "business" ? { firmName: "Synthetic Firm", practiceAreas: ["appeals"], casesLast12mBand: "<25" } : {}),
          }, { source: "controlled-test", funnelContext: { utm_source: "captured", utm_medium: "test", utm_campaign: "bounded" } });
      }
      await finalizeControlledFixture(isolated.db, config, config.controlled!.records[0].submissionId);
      await preflightControlled(config, client);
      expect(mutations).toHaveLength(0);
      const worker = new GhlWorker(isolated.db, client, config);
      for (let i = 0; i < 18; i++) await worker.tick();
      const states: any[] = (await isolated.pg.query("SELECT state,error_code FROM ema_ghl_operations")).rows;
      expect(states.filter(s => s.state !== "confirmed")).toEqual([]);
      expect(contacts).toHaveLength(3); expect(notes).toHaveLength(3); expect(opportunities).toHaveLength(3);
      expect(notes.every(n => n.body.includes("Captured attribution:") && n.body.includes("[ema-submission:"))).toBe(true);
      expect(opportunities.every(o => o.pipelineId === "pipeline" && o.pipelineStageId === "new-lead" && o.status === "open")).toBe(true);
      const before = [...mutations];
      for (const r of config.controlled!.records) {
        // Replay the completion/outbox request, not a second lead submission.
        const { complete } = await import("./snapshots");
        await isolated.db.transaction(tx => complete(tx, r.leadId, config));
      }
      for (let i = 0; i < 6; i++) await worker.tick();
      expect(mutations).toEqual(before);
      expect(mutations.some(m => m.includes("upsert"))).toBe(false);
    } finally { await isolated.close(); }
  }, 30000);
  it("controlled setup defaults offline and refuses incomplete live approval", async () => {
    // CLI imports are inert. Dynamic variable avoids adding scripts to TS rootDir.
    const path = "../../../scripts/ghl-setup.ts";
    const { runGhlSetup } = await import(path);
    const fetch = vi.fn();
    const plan = await runGhlSetup(["--controlled-live-account"], { fetch });
    expect(plan.destinationType).toBe("controlled-live-account"); expect(plan.definitions).toHaveLength(22);
    expect(fetch).not.toHaveBeenCalled();
    await expect(runGhlSetup(["--apply", "--controlled-live-account", "--location-id", location, "--approve-location", location],
      { fetch, env: { ...env(configuration()), EMA_GHL_SETUP_ENABLED: "true" } })).rejects.toThrow("CONTROLLED_SETUP_APPROVAL_REQUIRED");
    expect(fetch).not.toHaveBeenCalled();
  });
});