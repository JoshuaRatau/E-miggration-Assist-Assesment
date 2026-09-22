import { describe, expect, it, vi } from "vitest";
import { HttpGhlClient } from "./client";

function client(body: unknown) {
  const transport = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  return { transport, api: new HttpGhlClient({
    enabled: true, allowWrites: false, environment: "test", locationId: "reviewed-location",
    approvedLocationId: "reviewed-location", getToken: () => "intercepted-only", fetch: transport,
  }) };
}
const search = "/opportunities/search?locationId=reviewed-location&contactId=owned-contact";
describe("provider opportunity search type=string fieldValueString contract; intercepted only", () => {
  it("normalizes exact search-only string discriminator and preserves pagination and all other data", async () => {
    const body = { opportunities: [{ id: "owned-opportunity", contactId: "owned-contact",
      customFields: [
        { id: "lead-marker", type: "string", fieldValueString: "exact-owned-lead" },
        { id: "reference", type: "string", fieldValueString: "EMA-CONTROLLED-TEST-individual" },
      ] }], meta: { total: 1, nextPage: "" } };
    const { api, transport } = client(body);
    const result = await api.request("GET", search);
    expect(result.body.opportunities[0].customFields).toEqual(body.opportunities[0].customFields.map(f =>
      ({ ...f, fieldValue: f.fieldValueString })));
    expect(result.body.meta).toEqual(body.meta);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]).toBeDefined();
  });
  it("keeps the preexisting fieldValue search representation and accepts identical dual representations", async () => {
    const fields = [
      { id: "existing", fieldValue: "exact" },
      { id: "dual", type: "string", fieldValue: "Exact String", fieldValueString: "Exact String" },
    ];
    const { api } = client({ opportunities: [{ id: "opportunity", customFields: fields }] });
    expect((await api.request("GET", search)).body.opportunities[0].customFields).toEqual(fields);
  });
  it.each([
    { id: "field", type: "string", fieldValueString: "expected", fieldValue: "different" },
    { id: "field", type: "string", fieldValueString: "Exact", fieldValue: "exact" },
    { id: "field", type: "string", fieldValueString: "x", fieldValue: null },
    { id: "field", type: "string", fieldValueString: "x", fieldValueNumber: 7 },
    { id: "field", type: "string", fieldValueString: "x", value: "x" },
    { id: "field", type: "string", fieldValueString: 1 },
    { id: "field", type: "string", fieldValueString: null },
    { id: "field", type: "TEXT", fieldValueString: "x" },
    { id: "field", type: "text", fieldValueString: "x" },
    { id: "field", type: "NUMBER", fieldValueString: "1" },
    { id: "field", fieldValueString: "x" },
    { type: "string", fieldValueString: "x" },
  ])("rejects uncertain/conflicting search representations %#", async field => {
    const { api } = client({ opportunities: [{ id: "opportunity", customFields: [field] }] });
    await expect(api.request("GET", search)).rejects.toMatchObject({ code: "INVALID_REMOTE_RESPONSE", status: 200 });
  });
  it("does not apply search aliases to individual opportunity GET or contact GET", async () => {
    const fields = [{ id: "marker", type: "string", fieldValueString: "owned-lead" }];
    const opportunity = client({ opportunity: { id: "opportunity", customFields: fields } });
    await expect(opportunity.api.request("GET", "/opportunities/opportunity"))
      .rejects.toMatchObject({ code: "INVALID_REMOTE_RESPONSE" });
    const contact = client({ contact: { id: "contact", customFields: fields } });
    await expect(contact.api.request("GET", "/contacts/contact"))
      .rejects.toMatchObject({ code: "INVALID_REMOTE_RESPONSE" });
    const normal = client({ opportunity: { id: "opportunity", customFields: [{ id: "marker", fieldValue: "owned-lead" }] } });
    await expect(normal.api.request("GET", "/opportunities/opportunity")).resolves.toMatchObject({ status: 200 });
  });
});