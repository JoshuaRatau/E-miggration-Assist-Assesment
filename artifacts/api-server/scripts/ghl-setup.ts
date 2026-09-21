import { fieldDefinitions } from "../src/lib/ghl/fields";
// Deliberately no network dependency and no environment/credential access.
if (process.argv.slice(2).some(arg => arg !== "--plan" && arg !== "--help"))
  throw new Error("LIVE_GHL_WRITES_DISABLED: setup accepts --plan or --help only");
console.log(JSON.stringify({
  mode: "plan-only", version: "v3",
  endpoint: "POST /locations/{isolatedTestLocationId}/customFields",
  instructions: "Review meanings/options, inspect definitions, and explicitly approve isolated setup before any future network-capable implementation. Do not match fields by name alone.",
  definitions: fieldDefinitions.map(({ key, ...requestBody }) => ({
    logicalMappingKey: `${requestBody.model}.${key}`, requestBody,
    note: "Use the returned provider field ID after future approved setup; do not assume a generated field key.",
  })),
}, null, 2));