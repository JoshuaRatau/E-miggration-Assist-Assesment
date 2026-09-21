#!/usr/bin/env bash
# Operator execution under the existing rollout approval.
# This pins the existing candidate bytes; rebuilds require regenerating this file.
set -euo pipefail
umask 077
SHA=40f7aabeccd94c90a0fe84d42f3713112bd5f193a72090fcf013c250def90419
API=/home/ubuntu/E-miggration-Assist-Assesment/artifacts/api-server
ARCHIVE=/home/ubuntu/ema-api-${SHA}.tar.gz
RELEASE=/home/ubuntu/ema-releases/api-${SHA}
OLD="$API/dist.rollback-${SHA}"
RESERVE=201326592
BOOKKEEPING=1048576

require_approval() {
  [[ "${2:-}" == --approved ]] || {
    printf 'STOP: this phase requires separate approval; nothing executed.\n' >&2
    exit 1
  }
}
check_archive() {
  printf '%s  %s\n' "$SHA" "$ARCHIVE" | sha256sum --check --status
}
check_release() {
  [[ -d "$RELEASE/api" && -f "$RELEASE/migrate.mjs" ]]
  (cd "$RELEASE"; sha256sum --check --status SHA256SUMS)
  env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node --check "$RELEASE/api/index.mjs"
}
restart_health() {
  pm2 restart immigration-api || return 1
  curl --fail --silent --show-error --retry 6 --retry-connrefused \
    --retry-delay 2 --max-time 10 --output /dev/null \
    http://127.0.0.1:5000/api/healthz || return 1
  curl --fail --silent --show-error --retry 3 --retry-delay 2 \
    --max-time 15 --output /dev/null \
    https://api.emigration-assist.com/api/healthz
}
case "${1:-}" in
  stage)
    require_approval "$@"
    check_archive
    # Archive has already arrived; reserve the extraction plus unchanged headroom.
    FREE=$(df -B1 --output=avail /home/ubuntu | tail -1 | tr -d ' ')
    (( FREE >= 37097472 + RESERVE + BOOKKEEPING )) || { echo 'STOP: capacity below budget.'; exit 1; }
    [[ ! -e "$RELEASE" && ! -L "$RELEASE" ]] || { echo 'STOP: release path already exists.'; exit 1; }
    mkdir -p /home/ubuntu/ema-releases
    mkdir "$RELEASE"
    tar --no-same-owner -xzf "$ARCHIVE" -C "$RELEASE"
    check_release
    env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node "$RELEASE/migrate.mjs" --plan
    echo 'Staged only. No application startup, database connection or PM2 change.'
    ;;
  migrate)
    require_approval "$@"
    check_release
    # Approved additive transactional path; external AWS PITR remains unverified.
    # Read the verified live process environment in memory; never print it.
    env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node - "$API" "$RELEASE" <<'NODE'
const fs=require("node:fs"), path=require("node:path"), crypto=require("node:crypto");
const {createRequire}=require("node:module");
void (async()=>{
let client, committed=false, phase="configuration";
const ensure=(ok,code)=>{if(!ok)throw Object.assign(new Error(),{safeCode:code});};
try {
  const [api,release]=process.argv.slice(2), matches=[];
  const dir="/home/ubuntu/.pm2/pids";
  for(const file of fs.readdirSync(dir).filter(n=>/^immigration-api-\d+\.pid$/.test(n))){
    const pid=fs.readFileSync(path.join(dir,file),"utf8").trim();
    if(!/^\d+$/.test(pid))continue;
    try{
      const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,"utf8")
        .split("\0").filter(s=>s.includes("=")).map(s=>{const i=s.indexOf("=");return[s.slice(0,i),s.slice(i+1)];}));
      if(fs.readlinkSync(`/proc/${pid}/cwd`)===api && env.name==="immigration-api" &&
         env.pm_exec_path===api+"/dist/index.mjs")matches.push(env);
    }catch{}
  }
  if(matches.length!==1)throw Error();
  const env=matches[0];
  if(!env.DATABASE_URL || env.NODE_ENV!=="production" ||
     env.EMA_GHL_CAPTURE_ENABLED==="true" || env.EMA_GHL_DELIVERY_ENABLED==="true" ||
     env.NODE_OPTIONS || env.NODE_PATH)throw Error();
  ensure(!/--env-file|--require|--import|(?:^|\s)-r/.test(env.node_args||""),"LOADER_FLAGS");
  const hashes={
    "0001_ema_ghl_outbox.sql":"325b1b6b5605402b6102cd8df734e794c4645618cb363db885d97f585e56b625",
    "0002_ema_ghl_production.sql":"146fe4f0a6f38038ed3e4fd71683a852cd1a2682be686c1b4675318577592fb0"
  };
  phase="migration_hashes";
  const migrations=Object.entries(hashes).map(([name,hash])=>{
    const raw=fs.readFileSync(path.join(release,"migrations",name),"utf8");
    ensure(crypto.createHash("sha256").update(raw).digest("hex")===hash,"MIGRATION_HASH_MISMATCH");
    const sql=raw.replace(/^((?:\s|--[^\n]*\n)*)BEGIN\s*;/i,"$1").replace(/COMMIT\s*;\s*$/i,"");
    ensure(sql!==raw && !/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql),"TRANSACTION_WRAPPER");
    return {name,hash,raw,sql};
  });
  const required={
    ema_assessment_submissions:["id","lead_id","flow","answers","attribution","captured_at","completed_at"],
    ema_ghl_operations:["id","submission_id","environment","location_id","kind","ordinal","state","attempts","available_at","lease_token","lease_until","remote_id","result","error_code","confirmed_at"],
    ema_ghl_attempts:["id","operation_id","action","started_at","finished_at","outcome","http_status","error_code"],
    ema_ghl_links:["environment","location_id","lead_id","contact_id","opportunity_id","latest_completed_at"],
    ema_ghl_worker_leases:["scope","token","expires_at"],
    ema_ghl_mutation_barriers:["scope","operation_id","action","created_at"]
  };
  const expectedFunction=migrations[0].raw.split("AS $$")[1].split("$$;")[0].trim();
  const {Client}=createRequire(path.join(release,"package.json"))("pg");
  const url=new URL(env.DATABASE_URL), host=url.hostname;
  ensure(host && url.username && url.pathname.length>1,"DATABASE_CONFIGURATION");
  let ssl;
  if(host==="localhost" || host==="127.0.0.1" || !host.includes("."))ssl=false;
  else if(env.DATABASE_SSL_CA?.trim()){
    const v=env.DATABASE_SSL_CA.trim();
    ssl={ca:v.startsWith("-----BEGIN")?v:fs.readFileSync(path.resolve(api,v),"utf8"),rejectUnauthorized:true};
  }else ssl={rejectUnauthorized:!(env.DATABASE_SSL_REJECT_UNAUTHORIZED==="false" || host.endsWith(".rds.amazonaws.com"))};
  for(const key of ["sslmode","ssl","sslrootcert","sslcert","sslkey","options"])url.searchParams.delete(key);
  client=new Client({connectionString:url.toString(),ssl,connectionTimeoutMillis:10000,
    options:"-c search_path=public -c statement_timeout=60000 -c lock_timeout=5000"});
  async function verifySchema(){
    const ledger=await client.query("SELECT name,sha256 FROM public.ema_release_migrations WHERE name=ANY($1::text[])",[Object.keys(hashes)]);
    ensure(ledger.rows.length===2 && ledger.rows.every(r=>hashes[r.name]===r.sha256),"LEDGER_ASSERTION");
    const tables=await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])",[Object.keys(required)]);
    ensure(tables.rows.length===6,"TABLE_ASSERTION");
    const columns=await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])",[Object.keys(required)]);
    const have=new Set(columns.rows.map(r=>r.table_name+":"+r.column_name));
    ensure(Object.entries(required).every(([t,cs])=>cs.every(c=>have.has(t+":"+c))),"COLUMN_ASSERTION");
    const checks=await client.query(`SELECT conrelid::regclass::text AS table_name, pg_get_expr(conbin,conrelid) AS expression, convalidated
      FROM pg_constraint WHERE contype='c' AND
      ((conrelid='public.ema_ghl_operations'::regclass AND conname='ema_ghl_operations_environment_check')
      OR (conrelid='public.ema_ghl_links'::regclass AND conname='ema_ghl_links_environment_check'))`);
    const expression="(environment = ANY (ARRAY['development'::text, 'test'::text, 'production'::text]))";
    ensure(checks.rows.length===2 && checks.rows.every(r=>r.convalidated && r.expression===expression),"ENVIRONMENT_CHECK_ASSERTION");
    const trigger=await client.query(`SELECT t.tgtype,t.tgenabled,p.prosrc,p.prorettype='trigger'::regtype AS returns_trigger,l.lanname
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_language l ON l.oid=p.prolang
      WHERE t.tgrelid='public.ema_assessment_submissions'::regclass AND t.tgname='ema_snapshot_immutable'
      AND NOT t.tgisinternal AND n.nspname='public' AND p.proname='ema_snapshot_immutable'`);
    ensure(trigger.rows.length===1 && Number(trigger.rows[0].tgtype)===19 &&
      ["O","A"].includes(trigger.rows[0].tgenabled) && trigger.rows[0].returns_trigger &&
      trigger.rows[0].lanname==="plpgsql" && trigger.rows[0].prosrc.trim()===expectedFunction,"IMMUTABILITY_ASSERTION");
    const index=await client.query(`SELECT i.indisunique,i.indisvalid,i.indisready,
      pg_get_expr(i.indpred,i.indrelid) AS predicate,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns
      FROM pg_index i WHERE i.indexrelid=to_regclass('public.ema_ghl_opportunity_owner')
        AND i.indrelid='public.ema_ghl_links'::regclass`);
    ensure(index.rows.length===1 && index.rows[0].indisunique && index.rows[0].indisvalid &&
      index.rows[0].indisready && index.rows[0].predicate==="(opportunity_id IS NOT NULL)" &&
      JSON.stringify(index.rows[0].columns)===JSON.stringify(["environment","location_id","opportunity_id"]),"OWNERSHIP_ASSERTION");
  }
  phase="connection"; await client.connect();
  phase="transaction"; await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(724301882)");
  const ledger=await client.query("SELECT to_regclass('public.ema_release_migrations') AS name");
  if(!ledger.rows[0].name){
    const existing=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'ema_ghl_%' OR tablename='ema_assessment_submissions')");
    ensure(existing.rows.length===0,"UNRECORDED_SCHEMA");
  }
  await client.query("CREATE TABLE IF NOT EXISTS public.ema_release_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  for(const migration of migrations){
    phase=migration.name;
    const prior=await client.query("SELECT sha256 FROM public.ema_release_migrations WHERE name=$1",[migration.name]);
    if(prior.rows.length){ensure(prior.rows[0].sha256===migration.hash,"LEDGER_HASH_MISMATCH");continue;}
    await client.query(migration.sql);
    await client.query("INSERT INTO public.ema_release_migrations(name,sha256) VALUES($1,$2)",[migration.name,migration.hash]);
  }
  phase="precommit_assertions"; await verifySchema();
  phase="commit"; await client.query("COMMIT"); committed=true;
  phase="postcommit_assertions"; await client.query("BEGIN READ ONLY"); await verifySchema(); await client.query("ROLLBACK");
  console.log("PASS: both migration hashes and schema assertions verified before COMMIT and again after COMMIT. AWS PITR remains unverified. Capture/delivery remain disabled.");
}catch(error){
  let rollbackConfirmed=false;
  try{if(client){await client.query("ROLLBACK");rollbackConfirmed=true;}}catch{}
  console.error(JSON.stringify({status:"STOP",phase,code:error.safeCode||"REDACTED_EXECUTION_ERROR",
    committed,rollbackConfirmed,commitOutcome:phase==="commit"?"UNKNOWN_REVIEW_LEDGER_BEFORE_RETRY":committed?"COMMITTED":"NOT_COMMITTED",
    activationPermitted:false}));
  process.exitCode=1;
}finally{try{if(client)await client.end();}catch{}}
})();
NODE
    printf '%s\n' "$SHA" > "$RELEASE/.migration-verified-v2"
    ;;
  activate)
    require_approval "$@"
    check_release
    # Prerequisites: reviewed environment report, successful migration and backup.
    # NODE_ENV=production; capture/delivery disabled; PM2 saved environment matches.
    [[ -d "$API/dist" && ! -L "$API/dist" && ! -e "$OLD" && ! -L "$OLD" ]] ||
      { echo 'STOP: original/rollback paths not in expected state.'; exit 1; }
    [[ -f "$RELEASE/.migration-verified-v2" && "$(cat "$RELEASE/.migration-verified-v2")" == "$SHA" ]] ||
      { echo 'STOP: successful approved migration phase not recorded.'; exit 1; }
    FREE=$(df -B1 --output=avail /home/ubuntu | tail -1 | tr -d ' ')
    (( FREE >= RESERVE + BOOKKEEPING )) || { echo 'STOP: safety reserves no longer available.'; exit 1; }
    pm2 stop immigration-api
    mv "$API/dist" "$OLD"
    ln -s "$RELEASE/api" "$API/dist"
    if ! restart_health; then
      echo 'STOP: activation/health failed. Run the prepared rollback phase; do not delete either release.'
      exit 1
    fi
    echo 'API restarted at the same configured path. Health passed; this is not GHL delivery proof.'
    ;;
  rollback)
    require_approval "$@"
    [[ -d "$OLD" && ! -L "$OLD" ]] || { echo 'STOP: rollback directory unavailable.'; exit 1; }
    if [[ -L "$API/dist" ]]; then
      [[ "$(readlink "$API/dist")" == "$RELEASE/api" ]] ||
        { echo 'STOP: unexpected active symlink.'; exit 1; }
      pm2 stop immigration-api
      unlink "$API/dist"
    elif [[ -e "$API/dist" ]]; then
      echo 'STOP: unexpected active directory; no overwrite performed.'
      exit 1
    else
      pm2 stop immigration-api
    fi
    mv "$OLD" "$API/dist"
    restart_health
    echo 'Original API restored. Database/additive migrations and new release preserved.'
    ;;
  *) echo 'Usage: bash ec2-api-release-ops.sh {stage|migrate|activate|rollback} --approved'; exit 1;;
esac