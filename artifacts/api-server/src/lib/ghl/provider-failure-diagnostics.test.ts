import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { HttpGhlClient, MockGhlClient, redactProviderFailureBody } from "./client";
import { fieldDefinitions } from "./fields";
import { GhlWorker, providerFailureDiagnostics } from "./worker";

const options = (transport: typeof fetch) => ({
  enabled: true,
  allowWrites: true,
  environment: "test" as const,
  locationId: "diagnostic-location",
  approvedLocationId: "diagnostic-location",
  getToken: () => "test-only-token",
  fetch: transport,
});

afterEach(() => vi.unstubAllGlobals());

describe("provider failure diagnostics redaction", () => {
  it("retains HTTP 400, an exact safe validation message, and header correlation provenance", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      statusCode: 400,
      message: "Validation Error",
    }), { status: 400, headers: { "x-request-id": "req_ABC-123" } }));
    const failure = await new HttpGhlClient(options(transport)).request("GET", "/contacts/contact-1")
      .catch(error => error);
    expect(failure).toMatchObject({
      code: "REMOTE_REJECTED",
      status: 400,
      providerResponse: { statusCode: 400, message: "Validation Error" },
      correlation: { id: "req_ABC-123", source: "response-header:x-request-id" },
    });
  });

  it("strips nested PII, credentials, names, and values while retaining response shape", () => {
    const redacted = redactProviderFailureBody({
      message: "Validation Error",
      errors: [{
        email: "person@example.invalid",
        phone: "+27820000000",
        firstName: "Private",
        value: "secret-value",
        authorization: "Bearer secret",
        "person@example.invalid": "private-key",
      }],
    });
    expect(redacted).toEqual({
      message: "Validation Error",
      errors: [{
        REDACTED_KEY_1: "REDACTED",
        REDACTED_KEY_2: "REDACTED",
        REDACTED_KEY_3: "REDACTED",
        REDACTED_KEY_4: "REDACTED",
        REDACTED_KEY_5: "REDACTED",
        REDACTED_KEY_6: "REDACTED",
      }],
    });
    expect(JSON.stringify(redacted)).not.toMatch(/person|2782|Private|secret-value|Bearer/);
  });

  it("redacts unknown or interpolated provider messages", () => {
    expect(redactProviderFailureBody({ message: "Validation failed for Jane jane@example.invalid" }))
      .toEqual({ message: "REDACTED" });
  });

  it("classifies only an exact known-safe duplicate-opportunity denial and retains safe field names", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: "Can not create duplicate opportunity for the contact.",
      errors: [{ field: "pipelineId" }, { field: "private@example.invalid" }],
    }), { status: 400 }));
    const failure = await new HttpGhlClient(options(transport)).request("POST", "/opportunities/", {
      locationId: "diagnostic-location",
    }).catch(error => error);
    expect(failure).toMatchObject({
      providerFailureReason: "DUPLICATE_OPPORTUNITY",
      classificationSource: "sanitizer:exact-message-allowlist",
      providerResponse: {
        message: "Can not create duplicate opportunity for the contact.",
        errors: [{ field: "pipelineId" }, { field: "REDACTED" }],
      },
    });
  });

  it("rejects overlong correlation IDs and accepts a bounded body traceId fallback", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: "Bad Request",
      meta: { traceId: "trace.safe-123" },
    }), { status: 400, headers: { "x-request-id": "x".repeat(129) } }));
    const failure = await new HttpGhlClient(options(transport)).request("GET", "/contacts/contact-1")
      .catch(error => error);
    expect(failure.correlation).toEqual({ id: "trace.safe-123", source: "body.traceId" });
    expect(failure.correlation.id.length).toBeLessThanOrEqual(128);
  });

  it.each(["Jane-Doe", "person@example.invalid", "+27820000000", "1234567890"])(
    "does not treat malformed body traceId %s as a provider correlation ID",
    async traceId => {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        message: "Bad Request",
        traceId,
      }), { status: 400 }));
      const failure = await new HttpGhlClient(options(transport)).request("GET", "/contacts/contact-1")
        .catch(error => error);
      expect(failure.correlation).toBeUndefined();
      expect(failure.providerResponse.traceId).toBe("REDACTED");
    },
  );

  it("journals only redacted validation diagnostics and exposes the narrow consumption API", async () => {
    const pg = new PGlite();
    try {
      await pg.exec("CREATE TABLE prelaunch_leads(id uuid PRIMARY KEY, reference_number text NOT NULL UNIQUE, consent_timestamp timestamptz)");
      for (const name of ["0001_ema_ghl_outbox.sql", "0003_ema_ghl_provider_failure_diagnostics.sql"]) {
        await pg.exec(await readFile(new URL(`../../../../../lib/db/drizzle/${name}`, import.meta.url), "utf8"));
      }
      const db = drizzle(pg);
      const leadId = randomUUID(), submissionId = randomUUID(), operationId = randomUUID();
      await db.execute(sql`INSERT INTO prelaunch_leads(id,reference_number) VALUES(${leadId},'DIAGNOSTIC-ONLY')`);
      await db.execute(sql`INSERT INTO ema_assessment_submissions(id,lead_id,flow,answers,attribution,completed_at)
        VALUES(${submissionId},${leadId},'individual',${JSON.stringify({
          email: "private@example.invalid",
          whatsapp: "+27820000000",
        })}::jsonb,'{}'::jsonb,now())`);
      await db.execute(sql`INSERT INTO ema_ghl_operations(id,submission_id,environment,location_id,kind,ordinal)
        VALUES(${operationId},${submissionId},'test','diagnostic-location','contact',0)`);
      const config = {
        environment: "test" as const,
        locationId: "diagnostic-location",
        pipelineId: "pipeline",
        stageId: "stage",
        fieldIds: Object.fromEntries(fieldDefinitions.map(field =>
          [`${field.model}.${field.key}`, `${field.model}-${field.key}`])),
      };
      const client = new MockGhlClient(async () => ({
        status: 400,
        body: {
          statusCode: 400,
          message: "Validation Error",
          details: { email: "private@example.invalid", name: "Private Person" },
        },
        headers: { "x-correlation-id": "corr.safe-400" },
      }));
      await new GhlWorker(db, client, config).tick();
      const diagnostics = await providerFailureDiagnostics(db, operationId);
      expect(diagnostics).toMatchObject([{
        attempt_id: expect.any(String),
        action: "contact.search.email",
        http_status: 400,
        error_code: "REMOTE_REJECTED",
        provider_response: {
          statusCode: 400,
          message: "Validation Error",
          details: { REDACTED_KEY_1: "REDACTED", name: "REDACTED" },
        },
        correlation_id: "corr.safe-400",
        correlation_source: "response-header:x-correlation-id",
      }]);
      expect(JSON.stringify(diagnostics)).not.toMatch(/private@example|Private Person|27820000000/);
    } finally {
      await pg.close();
    }
  });
});