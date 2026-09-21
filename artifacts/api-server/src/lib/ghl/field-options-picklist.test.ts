import { describe, expect, it, vi } from "vitest";
import { decodeRemoteFieldOptions, remoteFieldOptionsMatch } from "./field-options";
import { fieldDefinitions } from "./fields";

const { runGhlSetup } = await import("../../../scripts/" + "ghl-setup");

describe("GHL v3 picklist option decoding", () => {
  it("accepts the actual picklistOptions mode enumeration exactly", () => {
    const actual = { picklistOptions: ["individual", "overstay", "business"] };
    expect(decodeRemoteFieldOptions(actual)).toEqual({
      valid: true,
      values: ["individual", "overstay", "business"],
    });
    expect(remoteFieldOptionsMatch(actual, ["individual", "overstay", "business"])).toBe(true);
    expect(remoteFieldOptionsMatch(actual, ["individual", "overstay"])).toBe(false);
    expect(remoteFieldOptionsMatch(actual, ["individual", "overstay", "business", "other"])).toBe(false);
  });

  it.each([
    { picklistOptions: "individual" },
    { options: [1] },
    { picklistOptions: ["individual", "individual"] },
    { options: ["individual"], picklistOptions: ["business"] },
  ])("rejects malformed or conflicting provider representations", field => {
    expect(decodeRemoteFieldOptions(field).valid).toBe(false);
    expect(remoteFieldOptionsMatch(field, ["individual"])).toBe(false);
  });

  it("accepts matching legacy and actual representations, including order differences", () => {
    const field = {
      options: ["business", "individual", "overstay"],
      picklistOptions: ["individual", "overstay", "business"],
    };
    expect(remoteFieldOptionsMatch(field, ["individual", "overstay", "business"])).toBe(true);
  });

  it("reuses the four journaled fields when the created enum uses picklistOptions", async () => {
    const location = "approved-live-location";
    const ids = [
      "gzHlo94VYBgest1bhwBP",
      "2j8MgTjNmwjV9SV9SkPk",
      "yWoKZGJQQdHNIpyFmtKv",
      "2GAvpElQpLT1pLtUWGvJ",
    ];
    const existing = fieldDefinitions.slice(0, 4).map((definition, index) => ({
      ...definition,
      id: ids[index],
      fieldKey: `${definition.model}.${definition.key}`,
      ...(definition.options ? { options: undefined, picklistOptions: definition.options } : {}),
    }));
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (init?.method === "GET") {
        const model = new URL(String(url)).searchParams.get("model");
        return Response.json({ customFields: existing.filter(field => field.model === model) });
      }
      const body = JSON.parse(String(init?.body));
      const index = fieldDefinitions.findIndex(field => field.name === body.name && field.model === body.model);
      const definition = fieldDefinitions[index];
      return Response.json({ customField: {
        ...definition,
        id: `new-field-${index}`,
        fieldKey: `${definition.model}.${definition.key}`,
        ...(definition.options ? { options: undefined, picklistOptions: definition.options } : {}),
      } });
    });
    const reuse = existing.flatMap(field => ["--reuse", `${field.fieldKey}=${field.id}`]);
    const result = await runGhlSetup([
      "--apply", "--controlled-live-account", "--fields-only",
      "--location-id", location, "--approve-location", location,
      ...reuse,
    ], {
      env: {
        NODE_ENV: "test",
        EMA_GHL_SETUP_ENABLED: "true",
        GHL_LOCATION_ID: location,
        GHL_PRIVATE_INTEGRATION_TOKEN: "synthetic-test-token",
        EMA_GHL_CONTROLLED_SETUP_APPROVAL: "ALLOW_22_EMA_FIELDS_IN_LIVE_ACCOUNT",
        EMA_GHL_CONTROLLED_LIVE_APPROVED_LOCATION_ID: location,
      },
      fetch,
    });

    expect(result).toMatchObject({
      mappings: {
        "contact.ema_lead_id": ids[0],
        "contact.ema_reference": ids[1],
        "contact.ema_latest_submission_id": ids[2],
        "contact.ema_assessment_type": ids[3],
      },
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(18);
  });
});