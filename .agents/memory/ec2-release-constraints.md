---
name: EC2 release constraints
description: User-confirmed host limits and release boundaries that cannot be inferred from source code.
---

Prepare releases off-host for the existing Ubuntu EC2 machine, without increasing AWS storage. Do not remove, disable or resize its active 2 GB swapfile. The user confirmed the earlier roughly 319 MB free-space estimate was no longer valid on 2026-09-21. Always remeasure before any future deployment rather than carrying an old capacity figure forward.

**Why:** The user explicitly rejected increasing storage costs or making space by changing swap. Source installation/build can exceed the remaining disk even when a compiled release fits.

**How to apply:** Measure compressed and allocated extracted sizes plus logging/migration/emergency headroom. Preserve the existing runnable installation as rollback instead of copying the entire repository or dependency store. Do not authorize cleanup implicitly. Read-only discovery must establish actual PM2 script/cwd/interpreter, Nginx root/proxy, secret loading and database locality; repository defaults are not evidence of those host paths. Local production-support development does not authorize deployment, migration or real-lead activation.

Keep EC2 release preparation API-only until the frontend's actual hosting destination is independently verified.

**Why:** The user confirmed Nginx proxies the API host to localhost:5000 without frontend static-serving directives. A candidate frontend build is not evidence that it belongs on this server.

**How to apply:** Do not change frontend routing/hosting or deploy the candidate `/assessment/` assets as part of an API release.