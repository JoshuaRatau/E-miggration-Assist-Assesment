#!/usr/bin/env bash
# Read-only size/path inventory. No deletion, installation, build or log contents.
# Run as ubuntu. Candidate cache/build names are NOT permission to remove them.
(
set -u
repo=/home/ubuntu/E-miggration-Assist-Assesment
printf '\n== Exact current root free bytes ==\n'
df -B1 /
printf '\n== Repository allocation by directory (bytes; largest first) ==\n'
du -x -B1 --max-depth=2 "$repo" 2>/dev/null | sort -nr | head -50
printf '\n== Existing dependency and Git allocation ==\n'
for p in "$repo/node_modules" "$repo/.git"; do
  [ ! -d "$p" ] || du -x -B1 --max-depth=2 "$p" 2>/dev/null | sort -nr | head -25
done
printf '\n== Build/cache directories outside dependencies and Git ==\n'
find "$repo" -xdev -type d \
  \( -name node_modules -o -name .git \) -prune -o \
  -type d \( -name dist -o -name build -o -name coverage \
    -o -name .cache -o -name .vite -o -name .turbo \
    -o -name .next -o -name .pnpm-store \) \
  -exec du -sxB1 {} \; -prune 2>/dev/null | sort -nr | head -40
printf '\n== Known user cache/store locations (sizes only) ==\n'
for p in "$HOME/.cache" "$HOME/.npm" "$HOME/.local/share/pnpm/store" \
  "$HOME/.pnpm-store" "$repo/.pnpm-store"; do
  [ ! -d "$p" ] || du -x -B1 --max-depth=2 "$p" 2>/dev/null | sort -nr | head -20
done
printf '\n== Largest repository files: allocated bytes and path only ==\n'
find "$repo" -xdev -type f -printf '%b\t%p\n' 2>/dev/null \
  | sort -nr | head -30 | awk -F '\t' '{printf "%.0f bytes\t", $1*512; sub(/^[^\t]*\t/, ""); print}'
printf '\n== Recently modified files over 1 MiB: size/time/path only ==\n'
find "$repo" -xdev -type f -mtime -7 -size +1M \
  -printf '%s bytes\t%TY-%Tm-%Td %TH:%TM\t%p\n' 2>/dev/null \
  | sort -nr | head -30
printf '\nNo files changed. Sizes alone do not establish safe deletion.\n'
printf 'Protect the running API dist, its dependencies, rollback files, env files, uploads, database files and active swap.\n'
)