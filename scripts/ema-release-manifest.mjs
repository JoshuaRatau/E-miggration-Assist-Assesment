// Off-host metadata only: no archive, git mutation, network or deployment.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { APPROVED_MIGRATION_HASHES } from "./ec2-migration-assertions.mjs";

export const releaseBase = "fc969390fd4ac4713124e8eef714c64017104906";
// Explicit source overlay. Never recursively include a workspace or evidence folder.
export const publicSourceFiles = [
  "artifacts/api-server/scripts/build-ghl-tools.mjs",
  "artifacts/api-server/scripts/ghl-production-check.ts",
  "artifacts/api-server/scripts/ghl-setup.ts",
  "artifacts/api-server/src/lib/intakePersistence.ts",
  "artifacts/api-server/src/lib/intakePersistence.test.ts",
  ...["businessIntake.ts", "leads.ts", "overstayIntake.ts"]
    .map(name => `artifacts/api-server/src/routes/${name}`),
  ...[
    "client.ts", "config.ts", "controlled.ts", "continuation.ts", "recovery.ts",
    "fields.ts", "field-options.ts", "production.ts", "snapshots.ts", "worker.ts",
    "ghl.test.ts", "http-runtime.test.ts", "production.test.ts", "routes.test.ts",
    "opportunity-search-shape.test.ts", "provider-failure-diagnostics.test.ts",
  ].map(name => `artifacts/api-server/src/lib/ghl/${name}`),
  "artifacts/emigration-assist/src/lib/finalize-assessment.ts",
  ...["assessment.tsx", "business-assessment.tsx", "overstay-assessment.tsx"]
    .map(name => `artifacts/emigration-assist/src/pages/${name}`),
  "lib/db/src/schema/emaGhl.ts",
  "lib/api-spec/openapi.yaml",
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-zod/src/generated/api.ts",
  "lib/api-zod/src/generated/types/createLeadInput.ts",
  ...Object.keys(APPROVED_MIGRATION_HASHES).map(name => `lib/db/drizzle/${name}`),
  "scripts/ec2-migrate.mjs",
  "scripts/ec2-migration-assertions.mjs",
  "scripts/ec2-migrate.test.mjs",
  "scripts/ec2-migration-0003-tooling.test.mjs",
  "scripts/ec2-migration-single-case.test.mjs",
  "scripts/ema-pm2-ghl.cjs",
  "scripts/ema-pm2-ghl.test.cjs",
  "scripts/ema-release-manifest.mjs",
  "scripts/ema-release-manifest.test.mjs",
  "docs/ema-ghl-team-release.md",
  "docs/ghl-aws-rollout.md",
  "replit.md",
].sort();

export function createReleaseManifest() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== releaseBase) throw new Error("RELEASE_BASE_REVIEW_REQUIRED");
  const files = publicSourceFiles.map(path => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("RELEASE_SOURCE_NOT_REGULAR");
    const bytes = readFileSync(path);
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return {
    version: 1,
    baseRevision: releaseBase,
    sourceOverlaySha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    files,
    excluded: [
      ".local/", ".agents/", "attached_assets/", "docs/release-evidence/",
      "private controlled operator entrypoints and their execution journals",
      "credentials, environment dumps, checkpoint archives and user identity inputs",
    ],
    productionBuildCommand: "node artifacts/api-server/scripts/build-ghl-tools.mjs --production-only",
    humanReviewRequired: true,
    committed: false,
    deployed: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(createReleaseManifest(), null, 2));