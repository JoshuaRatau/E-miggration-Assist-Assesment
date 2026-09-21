// Replit-only build. Never imports the app or inherits production build secrets.
import fs from "node:fs";
import path from "node:path";
import { createRequire, isBuiltin } from "node:module";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const root = process.cwd();
const api = path.join(root, "artifacts/api-server");
const req = createRequire(path.join(api, "package.json"));
const { build } = req("esbuild");
const apiOnly = process.argv.includes("--api-only");
if (process.argv.length > 2 && (!apiOnly || process.argv.length !== 3))
  throw new Error("Usage: node scripts/ec2-build-release.mjs [--api-only]");
const base = process.env.RELEASE_BASE_PATH;
const apiBase = process.env.RELEASE_API_BASE;
if (!apiOnly && (!base || !/^\/(?:[\w-]+\/)*$/.test(base) || apiBase === undefined ||
    !(apiBase === "" || /^\/[\w/-]*$/.test(apiBase) || /^https:\/\/[^/?#@]+(?:\/[\w/-]*)?$/.test(apiBase)))) {
  throw new Error("Set RELEASE_BASE_PATH (e.g. /assessment/) and RELEASE_API_BASE (empty for same-origin /api; never append /api). Public values only.");
}
const out = path.join(root, apiOnly ? "dist/ec2-api-release" : "dist/ec2-release");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "api"), { recursive: true });
if (!apiOnly) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", BASE_PATH: base, VITE_API_URL: apiBase };
  // Vite loads .env files even with a clean process environment. Refuse rather than leak.
  for (const dir of [root, path.join(root, "artifacts/emigration-assist")]) {
    if (fs.readdirSync(dir).some(n => /^\.env(?:$|\.)/.test(n) && n !== ".env.example"))
      throw new Error("Remove local frontend/root .env build inputs from build checkout; secrets must not enter artifact.");
  }
  execFileSync("pnpm", ["--filter", "@workspace/emigration-assist", "build"], { cwd: root, env, stdio: "inherit" });
  fs.cpSync(path.join(root, "artifacts/emigration-assist/dist/public"), path.join(out, "public"), { recursive: true });
}

// Keep path-sensitive packages intact; bundle ordinary JS. No test-only PGlite.
const external = ["pino", "pino-http", "pg-boss", "file-type", "nodemailer", "@google-cloud/storage",
  "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "@aws-sdk/lib-storage", "pg"];
const options = {
  bundle: true, platform: "node", format: "esm", target: "node22.12", sourcemap: false,
  external: [...external, "pg-native"], metafile: true,
  banner: { js: `import {createRequire as __cr} from 'node:module'; import {fileURLToPath as __url} from 'node:url'; import {dirname as __dir} from 'node:path'; const require=__cr(import.meta.url); const __filename=__url(import.meta.url); const __dirname=__dir(__filename);` },
  plugins: [{
    name: "exclude-isolated-pglite",
    setup(b) {
      b.onResolve({ filter: /^(@electric-sql\/pglite|drizzle-orm\/pglite)$/ }, a => ({ path: a.path, namespace: "test-only" }));
      b.onLoad({ filter: /.*/, namespace: "test-only" }, () => ({
        contents: 'export function PGlite(){throw new Error("PGlite isolated tests are not included in production release")} export function drizzle(){throw new Error("PGlite isolated tests are not included in production release")}',
      }));
    },
  }],
};
const result = await build({ ...options, entryPoints: [path.join(api, "src/index.ts")], outfile: path.join(out, "api/index.mjs") });
const externalImports = [...new Set(Object.values(result.metafile.outputs).flatMap(o => o.imports.filter(i => i.external).map(i => i.path)))];
const optionalImports = {
  "supports-color": "debug optional color probing catches MODULE_NOT_FOUND; not needed for production JSON logging",
  "@react-email/render": "Resend optional React rendering; application sends text and does not use React email",
};
for (const name of externalImports) {
  if (!isBuiltin(name) && !external.includes(name) && !(name in optionalImports))
    throw new Error(`Unreviewed runtime external: ${name}`);
}
await build({ ...options, entryPoints: [path.join(root, "scripts/ec2-migrate.mjs")], outfile: path.join(out, "migrate.mjs") });
// Preserve each package's dependency resolution including multiple versions.
const copied = new Map();
const packages = [];
function copyPackage(name, from, destination) {
  const paths = createRequire(path.join(from, "__resolve.cjs")).resolve.paths("__package_lookup__");
  let dir = paths.map(p => path.join(p, name)).find(p => fs.existsSync(path.join(p, "package.json")));
  if (!dir) throw new Error(`Cannot find package ${name}`);
  dir = fs.realpathSync(dir);
  const link = path.join(destination, name);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (copied.has(dir)) {
    if (!fs.existsSync(link)) fs.symlinkSync(path.relative(path.dirname(link), copied.get(dir)), link);
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json")));
  const target = path.join(out, "node_modules/.runtime", `${name.replaceAll("/", "+")}@${pkg.version}`);
  copied.set(dir, target);
  fs.cpSync(dir, target, { recursive: true, filter: src => {
    const basename = path.basename(src);
    const relative = path.relative(dir, src);
    const segments = relative.split(path.sep);
    return !["node_modules", ".git", ".github", "test", "tests", "__tests__", "docs", "doc", "example", "examples"].includes(basename) &&
      !segments.some(segment => [".git", ".github", "test", "tests", "__tests__"].includes(segment)) &&
      !/\.(?:map|d\.(?:ts|mts|cts))$/.test(basename);
  } });
  fs.symlinkSync(path.relative(path.dirname(link), target), link);
  packages.push({ name, version: pkg.version, engines: pkg.engines ?? {} });
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackage(dep, dir, path.join(target, "node_modules"));
  // pg-native is deliberately optional: pg uses pure JS unless explicitly requested.
}
for (const name of external) copyPackage(name, name === "pg" ? path.join(root, "lib/db") : api, path.join(out, "node_modules"));
fs.mkdirSync(path.join(out, "migrations"), { recursive: true });
for (const name of fs.readdirSync(path.join(root, "lib/db/drizzle")).filter(n => /^000[12]_.*\.sql$/.test(n)).sort())
  fs.copyFileSync(path.join(root, "lib/db/drizzle", name), path.join(out, "migrations", name));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const manifest = { commit, dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  nodeBuilt: process.version, nodeRequired: ">=22.12.0", platform: "linux", arch: "pure JS; validate host Node and optional native absence",
  mode: apiOnly ? "api-only" : "api-and-frontend", base: apiOnly ? null : base, apiBase: apiOnly ? null : apiBase,
  packages, externalImports, optionalImports };
fs.writeFileSync(path.join(out, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
const files = [];
function walk(dir) {
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n), stat = fs.lstatSync(p);
    if (stat.isDirectory()) walk(p);
    else if (stat.isFile()) {
      if (/(\.node$|\.env(?:\.|$)|\.pem$|\.key$)/.test(n)) throw new Error(`Forbidden/native file: ${p}`);
      files.push(`${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}  ${path.relative(out, p)}`);
    }
  }
}
walk(out);
fs.writeFileSync(path.join(out, "SHA256SUMS"), files.join("\n") + "\n");
const archiveName = apiOnly ? "ema-api-compiled.tar.gz" : "ema-compiled.tar.gz";
const archive = path.join(root, "dist", archiveName);
execFileSync("bash", ["-c", 'set -o pipefail; tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$1" -cf - . | gzip -n > "$2"', "_", out, archive]);
fs.writeFileSync(`${archive}.sha256`, `${crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex")}  ${archiveName}\n`);
console.log(JSON.stringify({ archiveBytes: fs.statSync(archive).size, extractedApparent: execFileSync("du", ["-sb", out], { encoding: "utf8" }).trim(), extractedAllocated: execFileSync("du", ["-sB1", out], { encoding: "utf8" }).trim(), fileCount: files.length }));