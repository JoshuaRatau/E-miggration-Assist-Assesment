import { describe, expect, it, vi } from "vitest";
import { fieldDefinitions } from "./fields";

const { runGhlSetup } = await import("../../../scripts/" + "ghl-setup");

const location = "approved-live-location";
const env = {
  NODE_ENV: "test",
  EMA_GHL_SETUP_ENABLED: "true",
  GHL_LOCATION_ID: location,
  GHL_PRIVATE_INTEGRATION_TOKEN: "synthetic-test-token",
  EMA_GHL_CONTROLLED_SETUP_APPROVAL: "ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT",
  EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID: location,
};
const args = [
  "--apply",
  "--controlled-live-account",
  "--fields-only",
  "--location-id", location,
  "--approve-location", location,
];

function field(index: number) {
  const definition = fieldDefinitions[index];
  return { ...definition, id: `field-${index}`, fieldKey: `${definition.model}.${definition.key}` };
}

function transport(existing: ReturnType<typeof field>[] = []) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === "GET") {
      const model = new URL(String(url)).searchParams.get("model");
      return Response.json({ customFields: existing.filter(item => item.model === model) });
    }
    const body = JSON.parse(String(init?.body));
    const index = fieldDefinitions.findIndex(item => item.name === body.name && item.model === body.model);
    return Response.json({ customField: field(index) });
  });
}

describe("GHL controlled live fields-only setup", () => {
  it.each([
    ["--fields-only"],
    ["--apply", "--fields-only", "--location-id", location, "--approve-location", location],
    [...args, "--fields-only"],
  ].map(invalidArgs => ({ invalidArgs })))("rejects invalid fields-only flag combinations before HTTP", async ({ invalidArgs }) => {
    const fetch = transport();
    await expect(runGhlSetup(invalidArgs, { env, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...env, NODE_ENV: "production" },
    { ...env, EMA_GHL_SETUP_ENABLED: "false" },
    { ...env, GHL_LOCATION_ID: "another-location" },
    { ...env, EMA_GHL_CONTROLLED_SETUP_APPROVAL: undefined },
    { ...env, EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID: "another-location" },
  ])("retains every environment and destination approval gate", async unsafeEnv => {
    const fetch = transport();
    await expect(runGhlSetup(args, { env: unsafeEnv, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("succeeds without a contact manifest and calls only custom-field GET/POST endpoints", async () => {
    const fetch = transport();
    const result = await runGhlSetup(args, { env, fetch });

    expect(result.mode).toBe("applied");
    expect(fetch).toHaveBeenCalledTimes(24);
    expect(fetch.mock.calls.slice(0, 2).every(([, init]) => init?.method === "GET")).toBe(true);
    for (const [url, init] of fetch.mock.calls) {
      expect(["GET", "POST"]).toContain(init?.method);
      expect(new URL(String(url)).pathname)
        .toBe(`/locations/${location}/customFields`);
    }
  });

  it("preserves the old controlled default manifest guard", async () => {
    const fetch = transport();
    const defaultArgs = args.filter(arg => arg !== "--fields-only");
    await expect(runGhlSetup(defaultArgs, { env, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks field collisions during full preflight without posting", async () => {
    const fetch = transport([field(0)]);
    await expect(runGhlSetup(args, { env, fetch }))
      .rejects.toThrow("FIELD_COLLISION_REQUIRES_EXPLICIT_REUSE_APPROVAL");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("leaves protected existing fields untouched", async () => {
    const protectedField = {
      ...field(0),
      id: "2iOXERu2s46l8kMCBiHz",
      fieldKey: "contact.work_email",
      name: "Work Email",
    };
    const fetch = transport([protectedField]);
    await runGhlSetup(args, { env, fetch });

    expect(fetch.mock.calls.every(([, init]) => ["GET", "POST"].includes(String(init?.method)))).toBe(true);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")
      .every(([, init]) => !String(init?.body).includes("Work Email"))).toBe(true);
  });
});