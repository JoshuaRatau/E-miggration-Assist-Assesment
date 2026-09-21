import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { captureConfig, captureEnabled, deliveryConfig, type GhlEnvironment } from "./config";
import { fieldDefinitions } from "./fields";
import { HttpGhlClient } from "./client";
import { saveAssessment } from "./snapshots";
import { validateProductionSchema, validateProductionDestination } from "./production";
import { startGhlDelivery } from "./runtime";
import { controlledConfig } from "./controlled";

const pg = new PGlite(), db = drizzle(pg);
const migration = async (name: string) => readFile(new URL(`../../../../../lib/db/drizzle/${name}`, import.meta.url), "utf8");
const env = (): GhlEnvironment => ({
  NODE_ENV: "production", EMA_GHL_CAPTURE_ENABLED: "true", EMA_GHL_DELIVERY_ENABLED: "true",
  EMA_GHL_DELIVERY_MODE: "production", EMA_GHL_PRODUCTION_CAPTURE_APPROVAL: "ALLOW_PRODUCTION_CAPTURE",
  EMA_GHL_PRODUCTION_DELIVERY_APPROVAL: "ALLOW_PRODUCTION_DELIVERY",
  EMA_GHL_PRODUCTION_SCHEMA_APPROVAL: "ALLOW_PRODUCTION_SCHEMA_V2",
  GHL_LOCATION_ID: "synthetic-location", EMA_GHL_APPROVED_PRODUCTION_LOCATION_ID: "synthetic-location",
  EMA_GHL_PIPELINE_ID: "synthetic-pipeline", EMA_GHL_STAGE_ID: "synthetic-stage",
  EMA_GHL_FIELD_IDS_JSON: JSON.stringify(Object.fromEntries(fieldDefinitions.map(f => [`${f.model}.${f.key}`, `${f.model}-${f.key}`]))),
  GHL_PRIVATE_INTEGRATION_TOKEN: "synthetic-token",
});
beforeAll(async () => {
  await pg.exec("CREATE TABLE prelaunch_leads(id uuid PRIMARY KEY,reference_number text NOT NULL UNIQUE,consent_timestamp timestamptz)");
  await pg.exec(await migration("0001_ema_ghl_outbox.sql"));
}, 30000);
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); })));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => pg.close());

describe("production gates and additive schema, isolated PGlite only", () => {
  it("defaults off; capture and delivery approvals are independent", () => {
    expect(captureEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(() => deliveryConfig({ NODE_ENV: "production" })).toThrow("DELIVERY_DISABLED");
    expect(captureConfig({ ...env(), EMA_GHL_DELIVERY_ENABLED: "false", EMA_GHL_PRODUCTION_DELIVERY_APPROVAL: "" }).environment).toBe("production");
    expect(deliveryConfig({ ...env(), EMA_GHL_CAPTURE_ENABLED: "false", EMA_GHL_PRODUCTION_CAPTURE_APPROVAL: "" }).environment).toBe("production");
    expect(captureConfig(env()).locationId).toBe(deliveryConfig(env()).locationId);
    expect(() => captureConfig({ ...env(), EMA_GHL_PRODUCTION_CAPTURE_APPROVAL: "" })).toThrow("PRODUCTION_CAPTURE_APPROVAL_REQUIRED");
  });
  it.each([
    ["EMA_GHL_PRODUCTION_DELIVERY_APPROVAL", ""], ["EMA_GHL_PRODUCTION_SCHEMA_APPROVAL", ""],
    ["EMA_GHL_APPROVED_PRODUCTION_LOCATION_ID", "other"], ["EMA_GHL_TEST_LOCATION_ID", "synthetic-location"],
    ["EMA_GHL_DELIVERY_MODE", "controlled-live"], ["EMA_GHL_CONTROLLED_MANIFEST_JSON", "{}"],
    ["EMA_GHL_PIPELINE_ID", ""], ["EMA_GHL_STAGE_ID", ""], ["EMA_GHL_FIELD_IDS_JSON", "{}"],
  ])("rejects invalid %s before DB or network", async (key, value) => {
    const loadDatabase = vi.fn(), transport = vi.fn();
    await expect(startGhlDelivery({ env: { ...env(), [key]: value }, loadDatabase, fetch: transport })).rejects.toBeDefined();
    expect(loadDatabase).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it("controlled approval cannot run in production even with a manifest", () => {
    expect(() => controlledConfig({ ...env(), EMA_GHL_CONTROLLED_LIVE_APPROVAL: "ALLOW_THREE_SYNTHETIC_RECORDS_IN_LIVE_ACCOUNT" }, "synthetic-location"))
      .toThrow("TEST_ENVIRONMENT_REQUIRED");
  });
  it("fails on v1 then accepts v2 without replacing or changing existing rows", async () => {
    await expect(validateProductionSchema(db)).rejects.toMatchObject({ code: "PRODUCTION_SCHEMA_NOT_READY" });
    const transport = vi.fn();
    await expect(startGhlDelivery({ env: env(), loadDatabase: async () => db, fetch: transport })).rejects.toMatchObject({ code: "PRODUCTION_SCHEMA_NOT_READY" });
    expect(transport).not.toHaveBeenCalled();
    await pg.exec("INSERT INTO ema_ghl_worker_leases VALUES('sentinel','11111111-1111-4111-8111-111111111111',now())");
    await pg.exec(await migration("0002_ema_ghl_production.sql"));
    await expect(validateProductionSchema(db)).resolves.toBeUndefined();
    expect((await pg.query("SELECT * FROM ema_ghl_worker_leases")).rows).toHaveLength(1);
  });
  it("requires BOTH production constraints and enabled immutable trigger", async () => {
    for (const table of ["ema_ghl_links", "ema_ghl_operations"]) {
      await pg.exec("BEGIN");
      await pg.exec(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_environment_check;
        ALTER TABLE ${table} ADD CONSTRAINT ${table}_environment_check CHECK(environment IN ('development','test'))`);
      await expect(validateProductionSchema(db)).rejects.toMatchObject({ code: "PRODUCTION_SCHEMA_NOT_READY" });
      await pg.exec("ROLLBACK");
    }
    await pg.exec("BEGIN; ALTER TABLE ema_assessment_submissions DISABLE TRIGGER ema_snapshot_immutable");
    await expect(validateProductionSchema(db)).rejects.toMatchObject({ code: "PRODUCTION_SCHEMA_NOT_READY" });
    await pg.exec("ROLLBACK");
  });
  it("capture schema failure precedes lead writes; incomplete approvals cannot capture", async () => {
    for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value!);
    const save = vi.fn();
    await pg.exec("BEGIN; ALTER TABLE ema_assessment_submissions DISABLE TRIGGER ema_snapshot_immutable");
    // Avoid a nested PGlite transaction: the injected executor still uses the
    // same isolated database and makes no lead writes.
    const database = { execute: db.execute.bind(db), transaction: async (fn: any) => fn(db) };
    await expect(saveAssessment(database, save, "overstay", {}, {}, true))
      .rejects.toMatchObject({ code: "PRODUCTION_SCHEMA_NOT_READY" });
    expect(save).not.toHaveBeenCalled();
    await pg.exec("ROLLBACK");
    vi.stubEnv("EMA_GHL_PRODUCTION_CAPTURE_APPROVAL", "");
    await expect(saveAssessment(database, save, "overstay", {}, {}, true))
      .rejects.toMatchObject({ code: "PRODUCTION_CAPTURE_APPROVAL_REQUIRED" });
    expect(save).not.toHaveBeenCalled();
  });
  it.each(["missing", "model", "type", "options", "pipeline"])("rejects mismatched remote %s read-only before worker", async kind => {
    const client = { request: vi.fn(async (_method: string, path: string) => {
      const model = new URL(path, "https://synthetic.invalid").searchParams.get("model");
      const fields: any[] = fieldDefinitions.filter(f => f.model === model).map(f =>
        ({ ...f, id: `${f.model}-${f.key}`, fieldKey: `${f.model}.${f.key}` }));
      if (fields.length) {
        if (kind === "missing") fields.pop();
        if (kind === "model") fields[0].model = "other";
        if (kind === "type") fields[0].dataType = "NUMBER";
        if (kind === "options" && model === "contact") fields.find(f => f.options).options = [];
      }
      return { status: 200, body: path.startsWith("/opportunities/pipelines")
        ? { pipelines: [{ id: "synthetic-pipeline", stages: [{ id: kind === "pipeline" ? "wrong" : "synthetic-stage" }] }] }
        : { customFields: fields } };
    }) };
    await expect(validateProductionDestination(client, deliveryConfig(env()))).rejects.toBeDefined();
    expect(client.request.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
  it("blocks production transport without its approval and never allows setup/upsert", async () => {
    const transport = vi.fn();
    const options = { enabled: true, allowWrites: true, environment: "production" as const,
      locationId: "synthetic-location", approvedLocationId: "synthetic-location", getToken: () => "synthetic-token", fetch: transport };
    await expect(new HttpGhlClient(options).request("GET", "/contacts/c")).rejects.toMatchObject({ code: "PRODUCTION_DELIVERY_APPROVAL_REQUIRED" });
    for (const path of ["/contacts/upsert", "/locations/synthetic-location/customFields"])
      await expect(new HttpGhlClient({ ...options, productionApproval: "ALLOW_PRODUCTION_DELIVERY" }).request("POST", path, { locationId: "synthetic-location" }))
        .rejects.toMatchObject({ code: "PRODUCTION_SETUP_WRITE_DENIED" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("captures atomically in production then completes all six operations using intercepted HTTP, replay no-op", async () => {
    for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value!);
    const lead = { id: randomUUID(), referenceNumber: "SYNTHETIC-PRODUCTION" };
    await saveAssessment(db, async tx => {
      await tx.execute(sql`INSERT INTO prelaunch_leads(id,reference_number) VALUES(${lead.id},${lead.referenceNumber})`);
      return [lead];
    }, "overstay", { email: "production-test@example.invalid", whatsapp: "+27820000000",
      firstName: "Synthetic", consentAccepted: true }, { source: "synthetic" }, true);
    expect((await pg.query("SELECT * FROM ema_ghl_operations WHERE environment='production'")).rows).toHaveLength(6);
    let contact: any, opportunity: any;
    const notes: any[] = [], mutations: string[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== "GET") mutations.push(`${method} ${path}`);
      let result: any;
      if (path.endsWith("/customFields")) result = { customFields: fieldDefinitions.filter(f => f.model === url.searchParams.get("model"))
        .map(f => ({ ...f, id: `${f.model}-${f.key}`, fieldKey: `${f.model}.${f.key}` })) };
      else if (path === "/opportunities/pipelines") result = { pipelines: [{ id: "synthetic-pipeline", stages: [{ id: "synthetic-stage" }] }] };
      else if (path === "/contacts/search/duplicate") result = { contact: contact ?? null };
      else if (path === "/contacts/") {
        contact = { ...body, id: "synthetic-contact", customFields: body.customFields.map((f: any) => ({ id: f.id, value: f.fieldValue })) };
        result = { contact };
      } else if (path === "/contacts/synthetic-contact") result = { contact };
      else if (path === "/contacts/synthetic-contact/notes") {
        if (method === "POST") { const note = { ...body, id: "synthetic-note", contactId: "synthetic-contact" }; notes.push(note); result = { note }; }
        else result = { notes };
      } else if (path.endsWith("/notes/synthetic-note")) result = { note: notes[0] };
      else if (path === "/opportunities/search") result = { opportunities: opportunity ? [opportunity] : [] };
      else if (path === "/opportunities/") { opportunity = { ...body, id: "synthetic-opportunity" }; result = { opportunity }; }
      else if (path === "/opportunities/synthetic-opportunity") result = { opportunity };
      else throw new Error("UNEXPECTED_INTERCEPTED_PATH");
      return new Response(JSON.stringify(result), { status: 200 });
    });
    const runtime = await startGhlDelivery({ env: env(), loadDatabase: async () => db, fetch: transport, intervalMs: 5 });
    try {
      await vi.waitFor(async () => {
        const rows = (await pg.query<any>("SELECT state,error_code FROM ema_ghl_operations")).rows;
        expect(rows).toHaveLength(6);
        expect(rows.every(r => r.state === "confirmed")).toBe(true);
      }, { timeout: 8000 });
    } finally { await runtime.stop(); }
    expect(mutations).toEqual(["POST /contacts/", "POST /contacts/synthetic-contact/notes", "POST /opportunities/"]);
    const replay = await startGhlDelivery({ env: env(), loadDatabase: async () => db, fetch: transport });
    await replay.stop();
    expect(mutations).toHaveLength(3);
  }, 15000);
});