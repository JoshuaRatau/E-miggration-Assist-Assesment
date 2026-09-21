#!/usr/bin/env bash
# PREPARED ONLY. Do not run on EC2 without separate approval for the chosen phase.
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
    # ONLY after reviewed backup and environment/DB evidence. No .env sourcing.
    # Read the verified live process environment in memory; never print it.
    env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node - "$API" "$RELEASE" <<'NODE'
const fs=require("node:fs"), cp=require("node:child_process"), path=require("node:path");
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
  cp.execFileSync("/usr/bin/node",[release+"/migrate.mjs","--apply"],{
    cwd:api,env:{...env,EMA_APPLY_MIGRATIONS:"approved"},stdio:"inherit"
  });
}catch{console.error("STOP: migration/configuration verification failed; no activation performed.");process.exitCode=1;}
NODE
    printf '%s\n' "$SHA" > "$RELEASE/.migration-reviewed"
    ;;
  activate)
    require_approval "$@"
    check_release
    # Prerequisites: reviewed environment report, successful migration and backup.
    # NODE_ENV=production; capture/delivery disabled; PM2 saved environment matches.
    [[ -d "$API/dist" && ! -L "$API/dist" && ! -e "$OLD" && ! -L "$OLD" ]] ||
      { echo 'STOP: original/rollback paths not in expected state.'; exit 1; }
    [[ -f "$RELEASE/.migration-reviewed" && "$(cat "$RELEASE/.migration-reviewed")" == "$SHA" ]] ||
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