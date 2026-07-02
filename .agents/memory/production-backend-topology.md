---
name: Production backend topology (which API the live site talks to)
description: Why a "works in dev but 404s in prod" API bug can be a wrong-backend problem, not a code problem. Two separate backends exist.
---

# Production backend topology

This Repl's own deployment (from `getDeploymentInfo()`) serves at:
- `https://e-migrationassist.com` (primaryUrl)
- `https://immigrationassist.replit.app` (additionalUrls)

Both of these run the **current** committed code. Confirm with a direct probe:
`curl -s -o /dev/null -w "%{http_code}" -X POST -d '{}' https://immigrationassist.replit.app/api/<route>`
(400 = route exists and rejected the empty body; 404 = route missing).

**Gotcha:** the deployed Vite frontend (hosted on Vercel) resolves its API base from
`VITE_API_URL`. In at least one incident it was set to `https://api.emigration-assist.com`
— a SEPARATE, OLDER backend that is NOT one of this Repl's deployment domains and is
NOT updated when you publish from here. New API routes 404 there even though they work
on `immigrationassist.replit.app`.

**Why:** `emigration-assist.com` (with the hyphen, and its `api.` subdomain) is a
different domain from this Repl's `e-migrationassist.com`. Domain sprawl makes it easy
to point the site at the wrong server.

**How to apply:** when a route "works in dev / on `*.replit.app` but 404s on the live
site," first probe both backends. If they disagree, it's a wrong-backend / stale-server
problem, not a code bug. Fix by either (a) setting Vercel `VITE_API_URL` to
`https://immigrationassist.replit.app` and redeploying the frontend, or (b) attaching
`api.emigration-assist.com` as a verified custom domain on THIS Repl's deployment so it
serves current code.

## Autoscale vs pg-boss (separate reliability issue)
`.replit` sets `deploymentTarget = "autoscale"`, but the api-server runs pg-boss (durable
queue) + always-on single-replica workers (score worker 60s tick, campaign scheduler 30s
tick). Autoscale freezes/suspends idle instances, so pg-boss's long-lived DB connections
drop — deployment logs show recurring `Connection terminated due to connection timeout`
on pg-boss cron/supervise/poll. The correct target for this app is **Reserved VM**.
Changing it has cost implications (always-on), so confirm with the user first.
