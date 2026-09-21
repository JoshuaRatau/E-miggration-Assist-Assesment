// No app import/listen/startup. No database, mail or remote requests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const apiOnly = process.argv.includes("--api-only");
if (process.argv.length > 2 && (!apiOnly || process.argv.length !== 3))
  throw new Error("Usage: node scripts/ec2-verify-release.mjs [--api-only]");
const archive = apiOnly ? "dist/ema-api-compiled.tar.gz" : "dist/ema-compiled.tar.gz";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-release-verify-"));
const env = { PATH: process.env.PATH, HOME: dir, NODE_ENV: "production" };
try {
  execFileSync("tar", ["-xzf", path.resolve(archive), "-C", dir]);
  execFileSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dir, env, stdio: "pipe" });
  execFileSync(process.execPath, ["--check", "api/index.mjs"], { cwd: dir, env });
  execFileSync(process.execPath, ["migrate.mjs", "--plan"], { cwd: dir, env, stdio: "inherit" });
  const program = `
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const manifest=JSON.parse(fs.readFileSync('./release.json'));
if(manifest.mode!==${JSON.stringify(apiOnly ? "api-only" : "api-and-frontend")})throw Error('Unexpected release mode');
if(${apiOnly}&&fs.existsSync('./public'))throw Error('API-only release unexpectedly contains frontend');
function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n),s=fs.lstatSync(p);if(s.isSymbolicLink()){if(!fs.realpathSync(p).startsWith(process.cwd()+'/'))throw Error('Escaping symlink')}else if(s.isDirectory())walk(p)}}walk('.');
for(const name of ['pino','pino-http','pg-boss','file-type','nodemailer','pg','@google-cloud/storage','@aws-sdk/client-s3','@aws-sdk/lib-storage','@aws-sdk/s3-request-presigner'])await import(name);
const {fileTypeFromBuffer}=await import('file-type');
const kind=await fileTypeFromBuffer(Buffer.from([255,216,255,224,...new Array(32).fill(0)]));
if(kind?.ext!=='jpg')throw Error('File-type smoke failed');
const pino=(await import('pino')).default;
const transport=pino.transport({target:'pino/file',options:{destination:1}});
await new Promise((resolve,reject)=>{transport.once('ready',resolve);transport.once('error',reject)});
const logger=pino(transport);logger.info('isolated pino worker smoke');
transport.flushSync(); transport.end();
await new Promise(resolve=>setTimeout(resolve,100));
console.log('Standalone dependency imports, file-type, pino worker and internal symlinks PASS');
`;
  fs.writeFileSync(path.join(dir, "smoke.mjs"), program);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: dir, env, stdio: "inherit", timeout: 30000 });
  // Exercise the compiled runner with a local pg stub, never a database.
  fs.unlinkSync(path.join(dir, "node_modules/pg"));
  fs.mkdirSync(path.join(dir, "node_modules/pg"));
  fs.writeFileSync(path.join(dir, "node_modules/pg/package.json"), '{"type":"module","main":"index.js"}');
  fs.writeFileSync(path.join(dir, "node_modules/pg/index.js"), `
export default {Client:class {
async connect(){} async end(){}
async query(sql,args){
 if(sql.includes('to_regclass'))return {rows:[{name:process.env.STUB_CASE==='drift'?'ema_release_migrations':null}]};
 if(sql.includes('FROM pg_tables'))return {rows:[],rowCount:process.env.STUB_CASE==='existing'?1:0};
 if(sql.includes('SELECT sha256'))return {rows:[{sha256:'wrong-hash'}],rowCount:process.env.STUB_CASE==='drift'?1:0};
 if(sql.includes('CREATE TABLE ema_assessment')||sql.includes('ALTER TABLE ema_ghl_operations')){
   if(/^\\s*BEGIN;/m.test(sql)||/COMMIT;\\s*$/.test(sql))throw Error('nested transaction');
 }
 return {rows:[],rowCount:0};
}}};
`);
  execFileSync(process.execPath, ["migrate.mjs", "--apply"], {
    cwd: dir, env: { ...env, DATABASE_URL: "postgres://stub:stub@localhost/stub", EMA_APPLY_MIGRATIONS: "approved" }, stdio: "inherit",
  });
  console.log("Mocked migration runner fresh-schema path PASS (not SQL execution or real database verification)");
  for (const scenario of ["existing", "drift", "unapproved"]) {
    let failed = false;
    try {
      execFileSync(process.execPath, ["migrate.mjs", "--apply"], {
        cwd: dir, env: { ...env, DATABASE_URL: "postgres://stub:stub@localhost/stub",
          EMA_APPLY_MIGRATIONS: scenario === "unapproved" ? "" : "approved", STUB_CASE: scenario }, stdio: "pipe",
      });
    } catch { failed = true; }
    if (!failed) throw new Error(`Migration safeguard did not reject ${scenario}`);
  }
  console.log("Mocked migration existing-schema, hash-drift and missing-approval rejection PASS");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }