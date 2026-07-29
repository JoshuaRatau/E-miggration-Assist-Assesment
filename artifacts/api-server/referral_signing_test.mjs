/**
 * Offline verification of the referral firm-match HMAC contract.
 *
 * Run:  node ./referral_signing_test.mjs      (from artifacts/api-server, after `pnpm install`)
 *
 * Makes NO network calls — `globalThis.fetch` is stubbed so the outgoing
 * request is captured instead of sent. Asserts the check an EMA receiver
 * performs when it verifies over the RAW request bytes: recomputing
 * HMAC-SHA256 over the body actually on the wire must reproduce the
 * `x-referral-signature` header.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const SECRET = "verification-only-secret";

// Set before the module graph loads: production skips pino's pretty transport.
process.env.NODE_ENV = "production";
process.env.REFERRAL_TUNNEL_SECRET = SECRET;
process.env.EMA_APP_URL = "https://ema.invalid";

const here = path.dirname(fileURLToPath(import.meta.url));

// The logger is not under test and drags in pino's worker machinery.
const stubLogger = {
  name: "stub-logger",
  setup(b) {
    b.onResolve({ filter: /(^|\/)logger$/ }, (args) => ({
      path: args.path,
      namespace: "stub-logger",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub-logger" }, () => ({
      contents:
        "export const logger = { warn(){}, info(){}, error(){}, debug(){} };",
      loader: "js",
    }));
  },
};

const outDir = await mkdtemp(path.join(tmpdir(), "referral-signing-"));

/** HMAC-SHA256, base64url — an independent reimplementation of the contract. */
function sign(data, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function loadModuleUnderTest() {
  const outfile = path.join(outDir, "emaFirmDirectory.mjs");
  await build({
    entryPoints: [path.join(here, "src/lib/emaFirmDirectory.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [stubLogger],
  });
  return import(pathToFileURL(outfile).href);
}

/** Invoke the real match call with fetch stubbed; return what went on the wire. */
async function captureRequest(requestEmaFirmMatch, request) {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = {
      url: String(url),
      body: init.body,
      signature: init.headers["x-referral-signature"],
    };
    // 503 short-circuits response parsing; we only care about the request.
    return new Response(null, { status: 503 });
  };
  try {
    await requestEmaFirmMatch(request);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(captured, "fetch was never called");
  return captured;
}

const base = {
  leadReference: "LEAD-2026-0001",
  matterType: "work_visa",
  region: "gauteng",
  urgency: "high",
};

const cases = [
  { name: "no route or theme (was already passing)", request: base },
  {
    name: "route set — every lead from a tagged landing-page CTA",
    request: { ...base, route: "traveller" },
  },
  {
    name: "route + theme set — marketed traffic",
    request: { ...base, route: "overstay_undesirable", theme: "amnesty" },
  },
];

const { requestEmaFirmMatch } = await loadModuleUnderTest();

let failures = 0;
for (const { name, request } of cases) {
  const wire = await captureRequest(requestEmaFirmMatch, request);
  try {
    assert.equal(
      sign(wire.body, SECRET),
      wire.signature,
      "HMAC over the raw wire body does not reproduce x-referral-signature",
    );
    // The wire body must still be the same JSON document, just key-sorted.
    assert.deepEqual(JSON.parse(wire.body), request);
    const keys = Object.keys(JSON.parse(wire.body));
    assert.deepEqual(keys, [...keys].sort(), "wire body keys are not sorted");
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    console.error(`        wire body: ${wire.body}`);
  }
}

// Negative control: prove the assertion above actually discriminates. The
// pre-fix serialization (insertion order) must NOT verify once `route`/`theme`
// push `urgency` out of position.
{
  const request = { ...base, route: "traveller", theme: "amnesty" };
  const wire = await captureRequest(requestEmaFirmMatch, request);
  const insertionOrdered = JSON.stringify(request);
  try {
    assert.notEqual(
      insertionOrdered,
      wire.body,
      "insertion-ordered and key-sorted bytes are identical — case is not discriminating",
    );
    assert.notEqual(sign(insertionOrdered, SECRET), wire.signature);
    console.log("  PASS  negative control: insertion-ordered bytes fail verification");
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  negative control\n        ${err.message}`);
  }
}

await rm(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll referral signing checks passed");
