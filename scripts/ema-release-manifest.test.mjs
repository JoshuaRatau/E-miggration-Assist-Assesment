import assert from "node:assert/strict";
import { createReleaseManifest, publicSourceFiles } from "./ema-release-manifest.mjs";

assert.equal(new Set(publicSourceFiles).size, publicSourceFiles.length);
for (const path of publicSourceFiles) {
  assert(!path.startsWith(".local/") && !path.startsWith("attached_assets/"));
  assert(!path.startsWith("docs/release-evidence/"));
  assert(!/\/ghl-controlled-(?:recovery|continuation|diagnostic-retry|single-case)\.ts$/.test(path));
}
const first = createReleaseManifest(), second = createReleaseManifest();
assert.deepEqual(first, second);
assert.match(first.sourceOverlaySha256, /^[a-f0-9]{64}$/);
assert.equal(first.committed, false);
assert.equal(first.deployed, false);
console.log("PASS explicit deterministic source manifest excludes private execution inputs");