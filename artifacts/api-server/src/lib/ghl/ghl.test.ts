import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { snapshot, complete, saveAssessment, finalizeAssessment, cleanAnswers, type Flow } from "./snapshots";
import { GhlWorker, submissionDeliveryState } from "./worker";
import { MockGhlClient, type MockRequest, type MockResponse } from "./client";
import { fieldDefinitions, customValues } from "./fields";
import { liveGhlClient, type GhlConfig, GhlFailure } from "./config";

// Isolation by construction: new in-memory WASM Postgres. No @workspace/db,
// pg Pool, DATABASE_URL, network, application server, or disk database.
const pg = new PGlite();
const db = drizzle(pg);
const config: GhlConfig = {
  environment: "test", locationId: "synthetic-test-location",
  pipelineId: "synthetic-pipeline", stageId: "synthetic-stage",
  fieldIds: Object.fromEntries(fieldDefinitions.map(f => [`${f.model}.${f.key}`, `${f.model}-${f.key}`])),
};
const query = async (q: string) => (await pg.query<any>(q)).rows;
beforeAll(async () => {
  expect(pg.dataDir).toBeUndefined();
  console.info("ISOLATION VERIFIED: fresh in-memory PGlite, no DATABASE_URL, no network, synthetic data only.");
  await pg.exec("CREATE TABLE prelaunch_leads(id uuid PRIMARY KEY, reference_number text NOT NULL UNIQUE, consent_timestamp timestamptz)");
  const migration = await readFile(new URL("../../../../../lib/db/drizzle/0001_ema_ghl_outbox.sql", import.meta.url), "utf8");
  await pg.exec(migration);
}, 30000);
beforeEach(async () => {
  await pg.exec("TRUNCATE ema_ghl_attempts,ema_ghl_operations,ema_ghl_links,ema_ghl_worker_leases,ema_assessment_submissions,prelaunch_leads CASCADE");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await pg.close(); });

async function seed(flow: Flow = "individual", finished = true) {
  const lead = { id: randomUUID(), referenceNumber: `TEST-${randomUUID()}`, consentTimestamp: new Date() };
  const answers = {
    fullName: "Synthetic Person", email: "synthetic@example.invalid", whatsapp: "+27820000000",
    consentAccepted: true, preferredContactMethod: "email", immigrationSituation: "unknown",
    ...(flow === "overstay" ? { firstName: "Synthetic", currentSituation: "unsure_of_status", whatsappOptIn: false } : {}),
    ...(flow === "business" ? { practiceAreas: ["appeals"], casesLast12mBand: "<25", firmName: "Synthetic Firm" } : {}),
  };
  let id = "";
  await db.transaction(async tx => {
    await tx.execute(sql`INSERT INTO prelaunch_leads(id,reference_number) VALUES(${lead.id},${lead.referenceNumber})`);
    id = await snapshot(tx, lead, flow, answers, { source: "web_form", funnelContext: { utm_source: "synthetic", utm_medium: "test" } });
    if (finished) await complete(tx, lead.id, config);
  });
  return { lead, id };
}

function remoteMock(timeoutMs?: number) {
  let contact: any;
  const notes: any[] = [], opportunities: any[] = [], requests: MockRequest[] = [];
  let intercept: ((r: MockRequest) => Promise<MockResponse | undefined>) | undefined;
  const handle = async (r: MockRequest): Promise<MockResponse> => {
    requests.push(r);
    const intercepted = await intercept?.(r);
    if (intercepted) return intercepted;
    const fields = (b: any) => (b.customFields || []).map((f: any) => ({ id: f.id, value: f.fieldValue }));
    if (r.path.startsWith("/contacts/search/duplicate"))
      return { status: 200, body: { contact: contact ?? null } };
    if (r.path === "/contacts/upsert") {
      contact = { ...r.body, id: "contact-1", customFields: fields(r.body), dnd: true, tags: ["preserve"], untouched: "keep" };
      return { status: 201, body: { contact } };
    }
    if (r.path === "/contacts/contact-1") {
      if (r.method === "PUT") {
        const merged = new Map(contact.customFields.map((f: any) => [f.id, f]));
        fields(r.body).forEach((f: any) => merged.set(f.id, f));
        contact = { ...contact, ...r.body, customFields: [...merged.values()] };
      }
      return { status: 200, body: { contact } };
    }
    if (r.path === "/contacts/contact-1/notes") {
      if (r.method === "POST") {
        const note = { ...r.body, id: `note-${notes.length + 1}`, contactId: "contact-1" };
        notes.push(note);
        return { status: 201, body: { note } };
      }
      return { status: 200, body: { notes } };
    }
    if (r.path.startsWith("/contacts/contact-1/notes/"))
      return { status: 200, body: { note: notes.find(n => r.path.endsWith(`/${n.id}`)) } };
    if (r.path.startsWith("/opportunities/search")) return { status: 200, body: { opportunities } };
    if (r.path === "/opportunities/") {
      const opportunity = { ...r.body, id: "opportunity-1", customFields: r.body?.customFields };
      opportunities.push(opportunity);
      return { status: 201, body: { opportunity } };
    }
    if (r.path.startsWith("/opportunities/")) return { status: 200, body: { opportunity: opportunities.find(o => r.path.endsWith(`/${o.id}`)) } };
    throw new Error("UNEXPECTED_MOCK_REQUEST");
  };
  return {
    client: new MockGhlClient(handle, timeoutMs), requests, notes, opportunities,
    get contact() { return contact; }, set contact(c) { contact = c; },
    set intercept(fn: typeof intercept) { intercept = fn; },
  };
}
const run = async (w: GhlWorker, count = 6) => { for (let i = 0; i < count; i++) await w.tick(); };

describe("immutable completion and atomic outbox", () => {
  it("captures individual answers before finalisation, queues exactly once afterwards", async () => {
    const { lead, id } = await seed("individual", false);
    expect((await query("SELECT * FROM ema_ghl_operations")).length).toBe(0);
    expect((await query("SELECT completed_at FROM ema_assessment_submissions"))[0].completed_at).toBeNull();
    await db.transaction(tx => complete(tx, lead.id, config));
    await db.transaction(tx => complete(tx, lead.id, config));
    expect((await query("SELECT * FROM ema_ghl_operations")).length).toBe(6);
    expect(await submissionDeliveryState(db, id, config)).toBe("pending");
  });
  it.each(["overstay", "business"] as const)("atomically saves %s and completed delivery event", async flow => {
    await seed(flow);
    expect((await query("SELECT * FROM ema_assessment_submissions"))[0].completed_at).not.toBeNull();
    expect((await query("SELECT * FROM ema_ghl_operations")).length).toBe(6);
  });
  it("rolls back lead + snapshot when queue insert fails", async () => {
    const lead = { id: randomUUID(), referenceNumber: "TEST-ROLLBACK" };
    await expect(db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO prelaunch_leads VALUES(${lead.id},${lead.referenceNumber},null)`);
      await snapshot(tx, lead, "business", { consentAccepted: true }, {});
      await complete(tx, lead.id, { ...config, environment: "production" as any });
    })).rejects.toThrow();
    expect(await query("SELECT * FROM prelaunch_leads")).toHaveLength(0);
    expect(await query("SELECT * FROM ema_assessment_submissions")).toHaveLength(0);
  });
  it("rolls back lead when snapshot save fails", async () => {
    await expect(db.transaction(async tx => {
      const lead = { id: randomUUID(), referenceNumber: "TEST-FAIL" };
      await tx.execute(sql`INSERT INTO prelaunch_leads VALUES(${lead.id},${lead.referenceNumber},null)`);
      await snapshot(tx, lead, "invalid" as Flow, {}, {});
    })).rejects.toThrow();
    expect(await query("SELECT * FROM prelaunch_leads")).toHaveLength(0);
  });
  it("DB trigger rejects snapshot and completion rewriting", async () => {
    await seed();
    await expect(pg.exec("UPDATE ema_assessment_submissions SET answers='{}'")).rejects.toThrow("immutable assessment snapshot");
    await expect(pg.exec("UPDATE ema_assessment_submissions SET completed_at=now()+interval '1 day'")).rejects.toThrow("immutable assessment snapshot");
  });
  it("never backfills a legacy lead without snapshot", async () => {
    await complete(db, randomUUID(), config);
    expect(await query("SELECT * FROM ema_ghl_operations")).toHaveLength(0);
  });
  it("disabled feature uses original save path and never touches new tables", async () => {
    vi.stubEnv("EMA_GHL_CAPTURE_ENABLED", "false");
    const save = vi.fn(async () => [{ id: "saved", referenceNumber: "TEST" }]);
    const database: any = { execute: vi.fn(), transaction: vi.fn() };
    await saveAssessment(database, save, "individual", {}, {}, false);
    await finalizeAssessment(database, "saved");
    expect(save).toHaveBeenCalledWith(database);
    expect(database.transaction).not.toHaveBeenCalled();
    expect(database.execute).not.toHaveBeenCalled();
  });
  it("enabled intake wrapper commits the actual save and immutable outbox together", async () => {
    vi.stubEnv("EMA_GHL_CAPTURE_ENABLED", "true");
    vi.stubEnv("EMA_GHL_TEST_LOCATION_ID", "synthetic-wrapper-location");
    vi.stubEnv("NODE_ENV", "test");
    const lead = { id: randomUUID(), referenceNumber: "TEST-WRAPPER", consentTimestamp: new Date() };
    const save = async (tx: typeof db) => {
      await tx.execute(sql`INSERT INTO prelaunch_leads VALUES(${lead.id},${lead.referenceNumber},null)`);
      return [lead];
    };
    await saveAssessment(db, save, "business", { consentAccepted: true }, {}, true);
    expect(await query("SELECT * FROM prelaunch_leads")).toHaveLength(1);
    expect(await query("SELECT * FROM ema_assessment_submissions")).toHaveLength(1);
    expect(await query("SELECT * FROM ema_ghl_operations")).toHaveLength(6);
  });
  it("concurrent finalisation remains idempotent", async () => {
    const { lead } = await seed("individual", false);
    await Promise.all([db.transaction(tx => complete(tx, lead.id, config)), db.transaction(tx => complete(tx, lead.id, config))]);
    expect(await query("SELECT * FROM ema_ghl_operations")).toHaveLength(6);
  });
  it("removes controls and secrets, preserves attribution without invention", () => {
    expect(cleanAnswers({ website: "honeypot", verifiedOtpId: "secret", finalize: false, adminNotes: "private", nationality: "synthetic" }))
      .toEqual({ nationality: "synthetic" });
    const values = customValues({ id: "s", lead_id: "l", flow: "individual", completed_at: new Date(),
      answers: { consentAccepted: true }, attribution: { funnelContext: { utm_source: "actual" } } });
    expect(values.ema_utm_source).toBe("actual");
    expect(values).not.toHaveProperty("ema_utm_medium");
    expect(values).not.toHaveProperty("ema_utm_campaign");
    expect(values).not.toHaveProperty("ema_whatsapp_opt_in");
  });
});

describe("mock-only delivery and recovery", () => {
  it.each(["individual", "overstay", "business"] as const)("confirms all six operations for %s with read-back and safe fields", async flow => {
    const { id } = await seed(flow), mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    await run(worker);
    expect(await submissionDeliveryState(db, id, config)).toBe("synced");
    expect(mock.notes).toHaveLength(1);
    expect(mock.opportunities).toHaveLength(1);
    expect(mock.contact.dnd).toBe(true);
    expect(mock.contact.tags).toEqual(["preserve"]);
    for (const req of mock.requests.filter(r => r.method !== "GET")) {
      expect(req.body).not.toHaveProperty("dnd");
      expect(req.body).not.toHaveProperty("tags");
      expect(req.body).not.toHaveProperty("monetaryValue");
    }
    const attempts = await query("SELECT * FROM ema_ghl_attempts");
    expect(attempts.some(a => a.http_status === 201)).toBe(true);
    expect(JSON.stringify(attempts)).not.toContain("synthetic@example.invalid");
    expect(await worker.tick()).toBe(false);
    expect(mock.notes).toHaveLength(1);
  });
  it("stops email/phone conflict before any write", async () => {
    const { id } = await seed(), mock = remoteMock();
    mock.intercept = async r => r.path.includes("search/duplicate") ? {
      status: 200, body: { contact: { id: r.path.includes("&email=") ? "a" : "b", locationId: config.locationId } },
    } : undefined;
    await new GhlWorker(db, mock.client, config).tick();
    expect(await submissionDeliveryState(db, id, config)).toBe("needs_attention");
    expect(mock.requests.every(r => r.method === "GET")).toBe(true);
  });
  it("reconciles a note created before response was lost, never repeats POST", async () => {
    const { id } = await seed(), mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    await run(worker, 2);
    let once = false;
    mock.intercept = async r => {
      if (r.method === "POST" && r.path.endsWith("/notes") && !once) {
        once = true;
        mock.notes.push({ ...r.body, id: "lost-note", contactId: "contact-1" });
        throw new Error("lost response with private payload must not persist");
      }
      return undefined;
    };
    await worker.tick();
    await pg.exec("UPDATE ema_ghl_operations SET available_at=now() WHERE state='retry'");
    await run(worker, 4);
    expect(await submissionDeliveryState(db, id, config)).toBe("synced");
    expect(mock.requests.filter(r => r.method === "POST" && r.path.endsWith("/notes"))).toHaveLength(1);
  });
  it("pauses an unresolved ambiguous contact create rather than duplicating", async () => {
    await seed(); const mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    mock.intercept = async r => { if (r.path === "/contacts/upsert") throw new Error("lost"); return undefined; };
    await worker.tick();
    await pg.exec("UPDATE ema_ghl_operations SET available_at=now() WHERE state='retry'");
    await worker.tick();
    expect((await query("SELECT error_code FROM ema_ghl_operations WHERE kind='contact'"))[0].error_code).toBe("AMBIGUOUS_CREATE");
    expect(mock.requests.filter(r => r.path === "/contacts/upsert")).toHaveLength(1);
  });
  it("reconciles ambiguous opportunity creation", async () => {
    const { id } = await seed(), mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    await run(worker, 4);
    mock.intercept = async r => {
      if (r.path === "/opportunities/" && r.method === "POST") {
        mock.opportunities.push({ ...r.body, id: "lost-opportunity", customFields: r.body?.customFields });
        throw new Error("lost");
      }
      return undefined;
    };
    await worker.tick();
    await pg.exec("UPDATE ema_ghl_operations SET available_at=now() WHERE state='retry'");
    await run(worker, 2);
    expect(await submissionDeliveryState(db, id, config)).toBe("synced");
    expect(mock.requests.filter(r => r.path === "/opportunities/")).toHaveLength(1);
  });
  it("does not adopt unrelated existing opportunities", async () => {
    await seed(); const mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    mock.opportunities.push({ id: "unrelated", name: "Existing commercial case" });
    await run(worker, 6);
    expect((await query("SELECT error_code FROM ema_ghl_operations WHERE kind='opportunity'"))[0].error_code).toBe("OPPORTUNITY_OWNERSHIP_REVIEW");
    expect(mock.requests.filter(r => r.path === "/opportunities/")).toHaveLength(0);
  });
  it("honours rate limit retry delay and persists only controlled errors", async () => {
    await seed(); const mock = remoteMock();
    mock.intercept = async () => ({ status: 429, body: { personal: "do not store" }, retryAfterMs: 120000 });
    await new GhlWorker(db, mock.client, config).tick();
    const [op] = await query("SELECT *,extract(epoch from (available_at-now())) AS wait FROM ema_ghl_operations WHERE kind='contact'");
    expect(op.state).toBe("retry"); expect(Number(op.wait)).toBeGreaterThan(115);
    expect(JSON.stringify(await query("SELECT * FROM ema_ghl_attempts"))).not.toContain("do not store");
  });
  it.each([401, 403, 400])("blocks configuration/auth rejection %i without retry churn", async status => {
    await seed(); const mock = remoteMock();
    mock.intercept = async () => ({ status, body: {} });
    const worker = new GhlWorker(db, mock.client, config);
    await worker.tick(); expect(await worker.tick()).toBe(false);
    expect((await query("SELECT state FROM ema_ghl_operations WHERE kind='contact'"))[0].state).toBe("blocked");
  });
  it("does not mark synced when read-back differs", async () => {
    const { id } = await seed(), mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    await worker.tick(); mock.contact.email = "different@example.invalid";
    await worker.tick();
    expect(await submissionDeliveryState(db, id, config)).toBe("needs_attention");
    expect(mock.notes).toHaveLength(0);
  });
  it("protects newer remote fields and existing tags/DND", async () => {
    await seed(); const mock = remoteMock();
    mock.contact = { id: "contact-1", locationId: config.locationId, dnd: true, tags: ["keep"],
      customFields: [{ id: config.fieldIds["contact.ema_latest_completed_at"], value: "2099-01-01T00:00:00.000Z" }] };
    await run(new GhlWorker(db, mock.client, config), 2);
    expect(mock.requests.every(r => r.method === "GET")).toBe(true);
    expect(mock.contact.tags).toEqual(["keep"]);
  });
  it("serialises concurrent workers and recovers an expired operation lease", async () => {
    await seed(); const mock = remoteMock(), a = new GhlWorker(db, mock.client, config), b = new GhlWorker(db, mock.client, config);
    await Promise.all([a.tick(), b.tick()]);
    expect(mock.requests.filter(r => r.path === "/contacts/upsert")).toHaveLength(1);
    await pg.exec("UPDATE ema_ghl_operations SET state='running',lease_until=now()-interval '1 second' WHERE kind='contact_verify'");
    await b.tick();
    expect((await query("SELECT state FROM ema_ghl_operations WHERE kind='contact_verify'"))[0].state).toBe("confirmed");
  });
  it("fences a worker that loses its location lease during a remote request", async () => {
    await seed(); const mock = remoteMock();
    let replaced = false;
    mock.intercept = async r => {
      if (!replaced) {
        replaced = true;
        await pg.exec(`UPDATE ema_ghl_worker_leases SET token='${randomUUID()}'`);
      }
      return { status: 200, body: { contact: null } };
    };
    await new GhlWorker(db, mock.client, config).tick();
    expect(mock.requests).toHaveLength(1);
    expect((await query("SELECT state FROM ema_ghl_operations WHERE kind='contact'"))[0].state).toBe("running");
    expect(await query("SELECT * FROM ema_ghl_links")).toHaveLength(0);
  });
  it("production transport is hard blocked regardless of credentials or switches", () => {
    vi.stubEnv("GHL_PRIVATE_INTEGRATION_TOKEN", "synthetic-not-a-token");
    vi.stubEnv("EMA_GHL_WRITES_ENABLED", "true");
    expect(liveGhlClient).toThrow("LIVE_GHL_WRITES_DISABLED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("missing field mapping and pipeline fail explicitly, not guessed", async () => {
    await seed(); const mock = remoteMock();
    await new GhlWorker(db, mock.client, { ...config, fieldIds: {} }).tick();
    expect(mock.requests).toHaveLength(0);
    expect((await query("SELECT error_code FROM ema_ghl_operations WHERE kind='contact'"))[0].error_code).toBe("FIELD_MAPPING_REQUIRED");
  });
  it("preserves existing first-touch attribution, records current attribution in history", async () => {
    await seed(); const mock = remoteMock();
    const originals = ["ema_source", "ema_source_campaign", "ema_utm_source", "ema_utm_medium", "ema_utm_campaign", "ema_funnel_context"];
    mock.contact = { id: "contact-1", locationId: config.locationId,
      customFields: originals.map(key => ({ id: config.fieldIds[`contact.${key}`], value: `original-${key}` })) };
    await run(new GhlWorker(db, mock.client, config), 4);
    for (const key of originals)
      expect(mock.contact.customFields.find((f: any) => f.id === config.fieldIds[`contact.${key}`]).value).toBe(`original-${key}`);
    expect(mock.notes[0].body).toContain('"utm_source": "synthetic"');
    const update = mock.requests.find(r => r.method === "PUT")!;
    expect((update.body!.customFields as any[]).some(f => originals.some(key => config.fieldIds[`contact.${key}`] === f.id))).toBe(false);
  });
  it("legitimate newer assessment supersession does not block older history", async () => {
    const first = await seed(), mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    await worker.tick();
    await pg.exec("UPDATE ema_ghl_operations SET available_at=now()+interval '1 hour' WHERE kind='contact_verify'");
    const second = await seed();
    await worker.tick();
    expect(mock.contact.customFields.find((f: any) => f.id === config.fieldIds["contact.ema_latest_submission_id"]).value).toBe(second.id);
    await pg.exec(`UPDATE ema_ghl_operations SET available_at=now()-interval '1 hour' WHERE submission_id='${first.id}' AND kind='contact_verify'`);
    await worker.tick();
    const [verified] = await query(`SELECT * FROM ema_ghl_operations WHERE submission_id='${first.id}' AND kind='contact_verify'`);
    expect(verified.state).toBe("confirmed"); expect(verified.result.superseded).toBe(true);
    await worker.tick();
    expect(mock.notes.some(n => n.body.includes(first.id))).toBe(true);
  });
  it("a real late mock PUT cannot race a newer write: durable scope barrier requires review", async () => {
    await seed(); const mock = remoteMock(30), worker = new GhlWorker(db, mock.client, config);
    mock.contact = { id: "contact-1", locationId: config.locationId, customFields: [] };
    let release!: () => void;
    let lateCompleted!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const late = new Promise<void>(resolve => { lateCompleted = resolve; });
    mock.intercept = async r => {
      if (r.method === "PUT") {
        await released; // Deliberately cannot be cancelled by the caller's timeout.
        mock.contact = { ...mock.contact, ...r.body, customFields: (r.body!.customFields as any[]).map(f => ({ id: f.id, value: f.fieldValue })) };
        lateCompleted();
        return { status: 200, body: { contact: mock.contact } };
      }
      return undefined;
    };
    await worker.tick();
    expect(await query("SELECT * FROM ema_ghl_mutation_barriers")).toHaveLength(1);
    await seed();
    // A new worker/process must see the persisted barrier, not an in-memory flag.
    const restarted = new GhlWorker(db, mock.client, config);
    await pg.exec("UPDATE ema_ghl_operations SET available_at=now() WHERE state='retry'");
    await restarted.tick();
    expect((await query("SELECT error_code FROM ema_ghl_operations WHERE state='review'"))[0].error_code).toBe("UNRESOLVED_UPDATE_REVIEW");
    expect(await restarted.tick()).toBe(false);
    release(); await late;
    expect(await restarted.tick()).toBe(false); // late completion alone is not an operator resolution
    expect(mock.requests.filter(r => r.method === "PUT")).toHaveLength(1);
    expect(await query("SELECT * FROM ema_ghl_mutation_barriers")).toHaveLength(1);
  });
  it("opportunity reconciliation uses provider fieldValue, not contact value shape", async () => {
    await seed(); const mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    await run(worker, 5);
    expect(mock.opportunities[0].customFields[0]).toHaveProperty("fieldValue");
    expect(mock.opportunities[0].customFields[0]).not.toHaveProperty("value");
    await worker.tick();
    expect((await query("SELECT state FROM ema_ghl_operations WHERE kind='opportunity_verify'"))[0].state).toBe("confirmed");
  });
  it("recovers a contact create whose success response was lost using reads only", async () => {
    await seed(); const mock = remoteMock(), worker = new GhlWorker(db, mock.client, config);
    mock.intercept = async r => {
      if (r.path === "/contacts/upsert") {
        mock.contact = { ...r.body, id: "contact-1",
          customFields: (r.body!.customFields as any[]).map(f => ({ id: f.id, value: f.fieldValue })) };
        throw new Error("synthetic lost contact response");
      }
      return undefined;
    };
    await worker.tick();
    await pg.exec("UPDATE ema_ghl_operations SET available_at=now() WHERE state='retry'");
    await worker.tick();
    expect(mock.requests.filter(r => r.method !== "GET")).toHaveLength(1);
    expect(await query("SELECT * FROM ema_ghl_mutation_barriers")).toHaveLength(0);
    expect((await query("SELECT state FROM ema_ghl_operations WHERE kind='contact'"))[0].state).toBe("confirmed");
  });
  it("missing pipeline selection blocks opportunity without guessing configured production IDs", async () => {
    await seed(); const mock = remoteMock();
    await run(new GhlWorker(db, mock.client, { ...config, pipelineId: undefined, stageId: undefined }));
    expect((await query("SELECT error_code FROM ema_ghl_operations WHERE kind='opportunity'"))[0].error_code).toBe("PIPELINE_STAGE_REQUIRED");
    expect(mock.opportunities).toHaveLength(0);
  });
});