import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { prelaunchLeadsTable } from "@workspace/db/schema";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { saveIntakeAssessment, sendIntakeOutcome } from "./intakePersistence";
import { finalizeAssessment, type Flow } from "./ghl/snapshots";

// Real isolated PostgreSQL transactions; no application connection or network.
const pg = new PGlite();
const db = drizzle(pg);
beforeAll(async () => {
  const columns = Object.values(getTableColumns(prelaunchLeadsTable))
    .map(column => `"${column.name}" ${column.getSQLType()}${column.name === "id" ? " PRIMARY KEY" : ""}`);
  await pg.exec(`CREATE TABLE prelaunch_leads(${columns.join(",")})`);
  for (const file of ["0001_ema_ghl_outbox.sql", "0005_ema_intake_receipts.sql"]) {
    await pg.exec(await readFile(new URL(`../../../../lib/db/drizzle/${file}`, import.meta.url), "utf8"));
  }
}, 30000);
beforeEach(async () => {
  await pg.exec("TRUNCATE prelaunch_leads CASCADE");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("EMA_GHL_TEST_LOCATION_ID", "synthetic-test");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => pg.close());

async function request(flow: Flow, identity: { email: string; whatsapp: string | null; attemptId?: unknown }, fail = false) {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (status: number) => { res.statusCode = status; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  try {
    const [lead] = await saveIntakeAssessment(db, async tx => {
      const lead = { id: randomUUID(), referenceNumber: `TEST-${randomUUID()}`, consentTimestamp: new Date() };
      await tx.execute(sql`INSERT INTO prelaunch_leads(id,reference_number,email,whatsapp,created_at)
        VALUES(${lead.id},${lead.referenceNumber},${identity.email},${identity.whatsapp},now())`);
      if (fail) throw new Error("SAVE_FAILED");
      return [lead];
    }, flow, { email: identity.email, whatsapp: identity.whatsapp, consentAccepted: true },
    { source: "synthetic" }, flow !== "individual", identity);
    // Only after COMMIT may the request acknowledge success.
    const committed = await pg.query("SELECT id FROM prelaunch_leads WHERE id=$1", [lead.id]);
    expect(committed.rows).toHaveLength(1);
    res.status(201).json({ leadId: lead.id, referenceNumber: lead.referenceNumber });
  } catch (error) {
    if (!sendIntakeOutcome(error, res)) res.status(500).json({ error: "Save failed" });
  }
  return res;
}
const count = async (table: string) => Number((await pg.query<{ n: number }>(`SELECT count(*) n FROM ${table}`)).rows[0].n);

describe.each([false, true])("concurrent intake, capture=%s", capture => {
  beforeEach(() => vi.stubEnv("EMA_GHL_CAPTURE_ENABLED", String(capture)));
  it("acquires independent normalized identity/attempt locks in deterministic order before reading or inserting", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const observed = {
      execute: db.execute.bind(db),
      transaction: (callback: (tx: any) => Promise<unknown>) => db.transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = ((statement: any) => {
          queries.push(new PgDialect().sqlToQuery(statement));
          return execute(statement);
        }) as typeof tx.execute;
        return callback(tx);
      }),
    };
    const attempt = randomUUID();
    await saveIntakeAssessment(observed as any, async (tx: any) => {
      const lead = { id: randomUUID(), referenceNumber: "LOCK-ORDER" };
      await tx.execute(sql`INSERT INTO prelaunch_leads(id,reference_number,email,whatsapp,created_at)
        VALUES(${lead.id},${lead.referenceNumber},'mixed@example.invalid','+27820000000',now())`);
      return [lead];
    }, "business", {}, {}, true,
    { email: " MIXED@example.invalid ", whatsapp: "+27820000000", attemptId: attempt });
    expect(queries.slice(0, 3).every(query => query.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.slice(0, 3).map(query => query.params[0])).toEqual([
      `attempt:${attempt}`, "email:mixed@example.invalid", "phone:+27820000000",
    ]);
  });
  it("serializes concurrent requests across all flows sharing email but different phone", async () => {
    const responses = await Promise.all((["individual", "overstay", "business"] as Flow[]).map((flow, i) =>
      request(flow, { email: i === 1 ? " PERSON@example.invalid " : "person@example.invalid", whatsapp: `+2782000000${i}` })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect(await count("prelaunch_leads")).toBe(1);
    expect(await count("ema_assessment_submissions")).toBe(capture ? 1 : 0);
  });
  it("serializes requests sharing phone but not email", async () => {
    const responses = await Promise.all(["individual", "business"].map((flow, i) =>
      request(flow as Flow, { email: `person${i}@example.invalid`, whatsapp: "+27820000000" })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect(await count("prelaunch_leads")).toBe(1);
  });
  it.each(["individual", "overstay", "business"] as Flow[])("%s replays concurrent/lost-response same attempt without new effects", async flow => {
    const identity = { email: "retry@example.invalid", whatsapp: "+27820000000", attemptId: randomUUID() };
    const results = await Promise.all([request(flow, identity), request(flow, identity)]);
    const replay = await request(flow, identity);
    expect(results.map(r => r.statusCode)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    expect(replay.body).toEqual(results[0].body);
    expect(await count("prelaunch_leads")).toBe(1);
    expect(await count("ema_intake_receipts")).toBe(1);
    expect(await count("ema_assessment_submissions")).toBe(capture ? 1 : 0);
    if (flow === "individual") await Promise.all([
      finalizeAssessment(db, replay.body.leadId), finalizeAssessment(db, replay.body.leadId),
    ]);
    expect(await count("ema_ghl_operations")).toBe(capture ? 6 : 0);
    const differentAttempt = await request(flow, { ...identity, attemptId: randomUUID() });
    expect(differentAttempt.statusCode).toBe(409);
  });
  it("rolls back lead, receipt and outbox together and allows the same attempt to retry", async () => {
    const identity = { email: "rollback@example.invalid", whatsapp: null, attemptId: randomUUID() };
    expect((await request("business", identity, true)).statusCode).toBe(500);
    expect(await count("prelaunch_leads")).toBe(0);
    expect(await count("ema_intake_receipts")).toBe(0);
    expect(await count("ema_ghl_operations")).toBe(0);
    expect((await request("business", identity)).statusCode).toBe(201);
  });
  it("rejects reused attempt with changed identity or assessment flow", async () => {
    const identity = { email: "first@example.invalid", whatsapp: null, attemptId: randomUUID() };
    expect((await request("business", identity)).statusCode).toBe(201);
    expect((await request("overstay", identity)).statusCode).toBe(409);
    expect((await request("business", { ...identity, email: "other@example.invalid" })).statusCode).toBe(409);
    expect(await count("prelaunch_leads")).toBe(1);
  });
});