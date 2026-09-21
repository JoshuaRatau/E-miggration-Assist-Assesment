import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(artifactDir, "dist");
const controlledSource = path.join(artifactDir, "src/lib/ghl/controlled.ts");
const dbRequire = createRequire(path.resolve(artifactDir, "../../lib/db/package.json"));
const pgEntry = dbRequire.resolve("pg");

// The source harness deliberately resolves its migration relative to its source
// module. A bundled module has a different location, so make that one asset
// reference distribution-relative without changing the tested source harness.
const bundledMigrationPlugin = {
  name: "controlled-migration-asset",
  setup(esbuild) {
    esbuild.onLoad({ filter: /src\/lib\/ghl\/controlled\.ts$/ }, async args => {
      const source = await readFile(args.path, "utf8");
      const original = 'new URL("../../../../../lib/db/drizzle/0001_ema_ghl_outbox.sql", import.meta.url)';
      if (args.path !== controlledSource || !source.includes(original))
        throw new Error("CONTROLLED_MIGRATION_REFERENCE_NOT_FOUND");
      return {
        contents: source.replace(original, 'new URL("./ema-ghl-outbox.sql", import.meta.url)'),
        loader: "ts",
      };
    });
  },
};

async function packagePgliteAssets() {
  const packageEntry = require.resolve("@electric-sql/pglite");
  const distDirInPackage = path.dirname(packageEntry);
  for (const asset of ["pglite.wasm", "initdb.wasm", "pglite.data"])
    await copyFile(path.join(distDirInPackage, asset), path.join(distDir, asset));
  await copyFile(
    path.resolve(artifactDir, "../../lib/db/drizzle/0001_ema_ghl_outbox.sql"),
    path.join(distDir, "ema-ghl-outbox.sql"),
  );
  const migrationsDir = path.join(distDir, "migrations");
  await mkdir(migrationsDir, { recursive: true });
  for (const name of ["0001_ema_ghl_outbox.sql", "0002_ema_ghl_production.sql"])
    await copyFile(path.resolve(artifactDir, "../../lib/db/drizzle", name), path.join(migrationsDir, name));
}

async function buildTools() {
  await mkdir(distDir, { recursive: true });
  await build({
    entryPoints: {
      "ghl-controlled-live": path.join(artifactDir, "scripts/ghl-controlled-live.ts"),
      "ghl-production-check": path.join(artifactDir, "scripts/ghl-production-check.ts"),
      "ghl-setup": path.join(artifactDir, "scripts/ghl-setup.ts"),
      "ema-migrate": path.resolve(artifactDir, "../../scripts/ec2-migrate.mjs"),
    },
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    target: "node20",
    format: "esm",
    bundle: true,
    treeShaking: true,
    logLevel: "info",
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __toolCreateRequire } from 'node:module'; const require = __toolCreateRequire(import.meta.url);",
    },
    external: ["pg-native"],
    alias: { pg: pgEntry },
    plugins: [bundledMigrationPlugin],
  });
  await packagePgliteAssets();
  await Promise.all([
    chmod(path.join(distDir, "ghl-controlled-live.mjs"), 0o755),
    chmod(path.join(distDir, "ghl-production-check.mjs"), 0o755),
    chmod(path.join(distDir, "ghl-setup.mjs"), 0o755),
    chmod(path.join(distDir, "ema-migrate.mjs"), 0o755),
  ]);
}

buildTools().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "GHL_TOOL_BUILD_FAILED"}\n`);
  process.exitCode = 1;
});