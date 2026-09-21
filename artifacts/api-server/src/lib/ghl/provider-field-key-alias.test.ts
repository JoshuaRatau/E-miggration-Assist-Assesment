import { describe, expect, it, vi } from "vitest";
import {
  expectedProviderFieldKey,
  fieldDefinitions,
  providerFieldKeyMatches,
} from "./fields";

const { runGhlSetup } = await import("../../../scripts/" + "ghl-setup");

const optIn = fieldDefinitions.find(field => field.key === "ema_whatsapp_opt_in")!;
const logicalKey = "contact.ema_whatsapp_opt_in";
const providerKey = "contact.ema_whatsapp_optin";
const existingId = "biieZXAsjkTT0p2suRr9";
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
  "--apply", "--controlled-live-account", "--fields-only",
  "--location-id", location, "--approve-location", location,
];

function transport() {
  return vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (init?.method === "GET") {
      const model = new URL(String(url)).searchParams.get("model");
      return Response.json({ customFields: model === "contact" ? [{
        ...optIn,
        id: existingId,
        fieldKey: providerKey,
        options: undefined,
        picklistOptions: optIn.options,
      }] : [] });
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
}

describe("GHL one-field provider key alias", () => {
  it("aliases only the WhatsApp opt-in provider key while preserving its logical key", () => {
    expect(expectedProviderFieldKey(optIn)).toBe(providerKey);
    expect(providerFieldKeyMatches(providerKey, optIn)).toBe(true);
    expect(providerFieldKeyMatches(logicalKey, optIn)).toBe(true);
    for (const definition of fieldDefinitions.filter(field => field !== optIn)) {
      expect(expectedProviderFieldKey(definition)).toBe(`${definition.model}.${definition.key}`);
      expect(providerFieldKeyMatches(`${definition.model}.${definition.key.replace("_", "")}`, definition))
        .toBe(false);
    }
  });

  it("detects the provider alias as a collision instead of recreating it", async () => {
    const fetch = transport();
    await expect(runGhlSetup(args, { env, fetch }))
      .rejects.toThrow("FIELD_COLLISION_REQUIRES_EXPLICIT_REUSE_APPROVAL");
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("reuses the existing aliased field under the unchanged logical mapping key", async () => {
    const fetch = transport();
    const result = await runGhlSetup([...args, "--reuse", `${logicalKey}=${existingId}`], { env, fetch });

    expect(result).toMatchObject({ mappings: { [logicalKey]: existingId } });
    expect(fetch.mock.calls.filter(([, init]) =>
      init?.method === "POST" && String(init.body).includes(optIn.name))).toHaveLength(0);
  });
});