#!/usr/bin/env bash
# READ ONLY. Run as ubuntu. No environment values, database queries or mutations.
set -u
repo=/home/ubuntu/E-miggration-Assist-Assesment
printf '\n== Platform / capacity ==\n'
uname -sm
node --version
getconf GNU_LIBC_VERSION
df -B1 / "$repo"
df -i / "$repo"
free -m
swapon --show --bytes --output NAME,TYPE,SIZE,USED,PRIO
printf '\n== Checkout metadata ==\n'
git -C "$repo" rev-parse --short HEAD
git -C "$repo" branch --show-current
printf '\n== PM2 selected fields only ==\n'
# Do not let pm2 launch a daemon if it is not already running.
if pgrep -u "$(id -u)" -f 'PM2.*God Daemon' >/dev/null; then
  pm2 jlist 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const p=JSON.parse(s).find(x=>x.name==="immigration-api");
 if(!p)throw Error("immigration-api not found");
 const e=p.pm2_env;
 console.log(JSON.stringify({name:p.name,pid:p.pid,status:e.status,mode:e.exec_mode,
 script:e.pm_exec_path,cwd:e.pm_cwd,interpreter:e.exec_interpreter,node_version:e.node_version,
 stdout:e.pm_out_log_path,stderr:e.pm_err_log_path},null,2));
});'
else printf 'PM2 daemon not detected; do not start one for this audit.\n'; fi
printf '\n== Relevant Nginx directives only (never headers) ==\n'
# Filter in memory: nginx -T raw output must never be shared or written to a file.
sudo -n nginx -T 2>/dev/null | awk '
 /^# configuration file / {print;next}
 /^[[:space:]]*(listen|server_name|root|alias|location|try_files|proxy_pass|access_log|error_log)[[:space:]]/ {
   line=$0;
   if(line ~ /https?:\/\/[^/[:space:]]*@/ || line ~ /\?/) {print "[redacted URL directive; operator review]";next}
   if(line ~ /^[[:space:]]*location[[:space:]]/) sub(/\{.*/, "{", line);
   else sub(/;.*/, ";", line);
   print line;
 }'
printf '\n== Metadata paths only: env/config/CA candidates ==\n'
find "$repo" -maxdepth 4 -type f \( -name '.env*' -o -name 'ecosystem*' -o -name '*.pem' \) -printf '%p\n' 2>/dev/null | head -60
printf '\n== Bounded sizes (no file contents) ==\n'
du -sxB1 "$repo" "$repo/node_modules" "$repo/artifacts/api-server/dist" "$repo/artifacts/emigration-assist/dist" "$HOME/.pm2/logs" /var/log/nginx /var/lib/postgresql 2>/dev/null
find "$HOME/.pm2/logs" /var/log/nginx -maxdepth 1 -type f -printf '%s bytes %p\n' 2>/dev/null | sort -nr | head -20
find "$repo/artifacts" -maxdepth 4 -type d \( -name dist -o -name uploads -o -name public \) -print 2>/dev/null | head -40
printf '\nDB locality, external env-file path and upload persistence require operator confirmation; do NOT send their values.\n'