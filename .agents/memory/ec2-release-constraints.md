---
name: EC2 release constraints
description: User-confirmed host limits and release boundaries that cannot be inferred from source code.
---

Prepare releases off-host for the existing Ubuntu EC2 machine, without increasing AWS storage. Do not remove, disable or resize its active 2 GB swapfile. The user reported an 8 GB disk with roughly 319 MB free after package-cache cleanup on 2026-09-21; remeasure before any future deployment.

**Why:** The user explicitly rejected increasing storage costs or making space by changing swap. Source installation/build can exceed the remaining disk even when a compiled release fits.

**How to apply:** Measure compressed and allocated extracted sizes plus logging/migration/emergency headroom. Preserve the existing runnable installation as rollback instead of copying the entire repository or dependency store. Do not authorize cleanup implicitly. Read-only discovery must establish actual PM2 script/cwd/interpreter, Nginx root/proxy, secret loading and database locality; repository defaults are not evidence of those host paths. Local production-support development does not authorize deployment, migration or real-lead activation.