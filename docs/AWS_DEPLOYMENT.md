# AWS Deployment — E-Migration Assist

Migration plan: Replit (current prod) → AWS (new prod), keeping Replit as the dev environment.

**Target topology after cutover:**

```
Browser → www.emigration-assist.com/assessment/*   (marketing site, Vercel project)
              │  rewrite (path-stripped)
              ▼
          <assessment>.vercel.app/*                 (this repo's Vite SPA build, unchanged)
              │  XHR / fetch with credentials
              ▼
          <app-runner-url>.awsapprunner.com/api/*   (App Runner, eu-west-1)
              │  VPC connector, private network
              ▼
          <rds-endpoint>.rds.amazonaws.com:5432     (RDS Postgres 16, eu-west-1)
```

**Region:** `eu-west-1` (Ireland) — chosen for App Runner availability with acceptable latency to South African users (~150ms baseline). See git history for the af-south-1 vs eu-west-1 tradeoff discussion.

**Phases:**
1. ✅ Phase 1 — Provision RDS Postgres + push schema (this document)
2. ⬜ Phase 2 — Dockerfile + App Runner service (pending Phase 1 completion)
3. ⬜ Phase 3 — Cutover (Vercel `VITE_API_URL` flip, App Runner `WEB_ORIGIN` set)
4. ⬜ Phase 4 — Lock down RDS public access, document final state

---

## Phase 1 — Provision RDS Postgres

### 1.1 Sizing & version recommendation

| Setting | Value | Rationale |
|---|---|---|
| Engine | PostgreSQL **16.x** (latest minor) | App uses Drizzle + pg-boss v12; both fully supported on PG 16. |
| Instance class | `db.t4g.micro` (2 vCPU, 1 GB RAM) | ~$15/mo. Sufficient for current load. Easy to scale up later — no data migration needed for instance-class change. |
| Storage | **20 GB gp3**, autoscaling enabled up to 100 GB | gp3 is cheaper and more performant than gp2. Autoscaling so you never run out unexpectedly. |
| Multi-AZ | **No** (for now) | Saves ~50% cost. App is non-critical enough that ~minutes of downtime during a rare AZ failure is acceptable. Switch to Multi-AZ later when revenue justifies it (one-click change, no migration). |
| Backups | **7-day** automated, default backup window | Default. Free up to DB size. |
| Deletion protection | **Enabled** | Prevents accidental `terraform destroy` style mistakes in the AWS console. |
| Public accessibility | **Yes (temporarily, for Phase 1)** | We need to run `pnpm db:push` from your laptop once. Phase 4 flips this to No. |
| Master username | `ema_admin` | Avoid the default `postgres` for slightly better security through obscurity. |
| Master password | **Auto-generate, store in Secrets Manager** | Don't pick a password yourself. Let AWS create one and Secrets Manager will hold it. |

**Estimated monthly cost (Phase 1 setup only):** ~$18/month (db.t4g.micro + 20 GB gp3 + backups). App Runner adds ~$25–35/mo on top in Phase 2.

### 1.2 Step-by-step in AWS Console

1. **Sign in to AWS Console** → top-right region selector → **Europe (Ireland) eu-west-1**. Confirm before clicking anything else.

2. Navigate to **RDS** → **Create database**.

3. **Choose a database creation method:** Standard create.

4. **Engine options:**
   - Engine type: **PostgreSQL**
   - Edition: PostgreSQL
   - Engine Version: **PostgreSQL 16.x** (pick the highest 16.x available; do not pick 17 yet — pg-boss v12 not yet certified on 17)

5. **Templates:** **Production** (gives sensible defaults; we override specific things below).

6. **Settings:**
   - DB instance identifier: `emigration-assist-prod`
   - Master username: `ema_admin`
   - Credentials management: **Managed in AWS Secrets Manager** ← important
   - Encryption key: `aws/secretsmanager` (default)

7. **Instance configuration:**
   - Burstable classes: **db.t4g.micro**

8. **Storage:**
   - Storage type: **gp3**
   - Allocated storage: **20** GiB
   - Storage autoscaling: **Enabled**, max 100 GiB

9. **Connectivity:**
   - Compute resource: Don't connect to an EC2 compute resource
   - VPC: **Default VPC** (we'll switch to a private setup in Phase 4 if you want; default VPC is fine for now)
   - DB subnet group: default
   - **Public access: Yes** (TEMPORARY — will be flipped to No in Phase 4)
   - VPC security group: **Create new** → name it `emigration-assist-rds-sg`
   - Availability Zone: No preference
   - Database port: 5432

10. **Database authentication:** Password authentication (default).

11. **Monitoring:** Enable Performance Insights (free tier), 7-day retention.

12. **Additional configuration (expand the section):**
    - Initial database name: **`ema_prod`** ← important, otherwise no DB is created
    - DB parameter group: default
    - Backup retention: **7 days**
    - Encryption: Enabled (default)
    - Deletion protection: **Enabled**
    - Performance Insights: keep enabled

13. Click **Create database**. Provisioning takes ~5–10 minutes.

### 1.3 Lock the security group to your laptop's IP

While RDS provisions:

1. Go to **EC2 → Security Groups** → find `emigration-assist-rds-sg`.
2. **Inbound rules** → Edit → there should already be a rule for port 5432.
3. Change Source from `0.0.0.0/0` (anywhere) to **My IP** — AWS auto-detects your current public IP.
4. Save.

**Why:** without this, anyone on the public internet who guesses your RDS endpoint + master password could connect. "My IP" restricts to your current location only. (Phase 4 removes public access entirely.)

If your laptop IP changes (different network, VPN, etc.) before Phase 4, just re-edit this rule. After Phase 4 it doesn't matter.

### 1.4 Retrieve the connection string

Once RDS shows **Available**:

1. RDS console → click your `emigration-assist-prod` instance.
2. Top of page: **Connectivity & security** tab → copy the **Endpoint** (e.g. `emigration-assist-prod.abc123xyz.eu-west-1.rds.amazonaws.com`).
3. Top of page: **Configuration** tab → scroll to "Master credentials ARN" → click the linked Secrets Manager entry.
4. In Secrets Manager: **Retrieve secret value** → copy the password.

Build your connection string:

```
postgresql://ema_admin:<URL-ENCODED-PASSWORD>@<endpoint>:5432/ema_prod?sslmode=require
```

**URL-encode the password** if it contains special characters (`@`, `/`, `?`, `#`, `:`, `%`). Easiest: paste it into any URL-encoding tool, or replace by hand using this table: `@` → `%40`, `/` → `%2F`, `?` → `%3F`, `#` → `%23`, `:` → `%3A`, `%` → `%25`, `+` → `%2B`.

`?sslmode=require` is **mandatory** — RDS rejects unencrypted connections by default and the app code expects SSL.

### 1.5 Push schema + seed admin user

From your laptop (or from the Replit Shell — both work since RDS is temporarily public):

```bash
# Set the prod DATABASE_URL ONLY for this command — don't export it permanently
DATABASE_URL='postgresql://ema_admin:<password>@<endpoint>:5432/ema_prod?sslmode=require' \
  pnpm db:push
```

You should see Drizzle output like:
```
[✓] Pulling schema from database...
[✓] Changes applied
```

This creates **all application tables** (leads, cases, admin, campaigns, templates, lifecycle, etc.). pg-boss tables (`pgboss.*`) will be auto-created later when the App Runner backend starts up — don't worry about them now.

**Seed the bootstrap admin user:** the api-server seeds a demo admin (`demo@admin.local` / `ChangeMe!2026`) automatically on first boot when `admin_users` is empty. To override with your real credentials, set `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` as App Runner env vars in Phase 2 — the seed runs once on first App Runner deploy, then never again.

### 1.6 Verify

Quick sanity check that the schema exists:

```bash
DATABASE_URL='postgresql://ema_admin:<password>@<endpoint>:5432/ema_prod?sslmode=require' \
  psql "$DATABASE_URL" -c '\dt'
```

You should see ~20+ tables. If you don't have `psql` installed locally, skip — we'll verify via App Runner in Phase 2.

### 1.7 Save the connection string somewhere safe

You'll need it again in Phase 2 when configuring App Runner. Save it to your password manager — **don't** paste it into Replit Secrets, into git, or into the chat with me. The whole point of Secrets Manager is that even AWS can rotate it without you ever needing to touch the value.

---

## Phase 1 done — what to tell the agent

When everything above is complete, message me:

> "Phase 1 done. RDS is provisioned, schema is pushed."

I'll then start Phase 2 (Dockerfile + App Runner setup). I won't need the connection string itself — only confirmation it works.

---

## Phase 2 — Dockerfile + App Runner (preview, not started yet)

What's coming so you know:
- A `Dockerfile` at the repo root that builds the api-server in a multi-stage pnpm-aware build
- An `apprunner.yaml` config so App Runner knows how to build & run
- Step-by-step App Runner setup (connect to GitHub, set env vars, configure VPC connector to RDS)
- Env-var checklist (DATABASE_URL, all the secrets currently in Replit)

Will deliver when Phase 1 is signed off.
