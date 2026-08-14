# Meta (Facebook & Instagram) Integration

The Meta Analytics module pulls real data from the Meta Graph API into
the EMA database and shows it at **/admin/meta-analytics**. The dashboard
never calls Meta directly — it reads cached data that the backend syncs.

## What you need

A free Meta developer app tied to the business's Facebook account:

1. Go to https://developers.facebook.com → **My Apps** → **Create App**
   (type: *Business*).
2. Add the products **Facebook Login for Business** and **Webhooks**.
3. Note the **App ID** and **App Secret** (Settings → Basic).

## Environment variables (API server)

| Variable | Required | Notes |
| --- | --- | --- |
| `META_APP_ID` | yes | From the Meta app dashboard |
| `META_APP_SECRET` | yes | Secret — also used to verify webhook signatures |
| `META_WEBHOOK_VERIFY_TOKEN` | for webhooks | Any random string; must match the value entered in the Meta dashboard |
| `META_GRAPH_API_VERSION` | no | Defaults to `v23.0` |
| `META_REDIRECT_URI` | no | Defaults to `https://<api-host>/api/meta/auth/callback` |

## OAuth redirect URL

In the Meta app → Facebook Login → Settings → **Valid OAuth Redirect
URIs**, add exactly:

```
https://<your-api-host>/api/meta/auth/callback
```

(The current value is shown in `GET /api/meta/status` as `redirectUri`.)

## Webhook (instant lead delivery)

Both halves of the webhook setup are automated — no manual Meta
dashboard steps needed:

1. **App-level subscription** (equivalent to the dashboard's Webhooks →
   Page config): `POST /api/meta/webhook/subscribe` (admin) registers the
   callback URL + verify token + `leadgen` field with the Meta app via
   `POST /{app-id}/subscriptions`. Meta synchronously verifies the
   callback URL with a GET challenge, so the URL must be publicly
   reachable and running current code (i.e. the **deployed** app —
   republish first if the webhook route 404s in production).
2. **Page-level subscription**: connecting via OAuth automatically calls
   `POST /{page-id}/subscribed_apps` with `subscribed_fields=leadgen`.
   `POST /api/meta/webhook/subscribe` also (re-)runs this for the current
   connection and returns the Page's actual `subscribed_fields` so you
   can confirm `leadgen` is active.

Configuration:

- Callback URL: `META_WEBHOOK_CALLBACK_URL` (defaults to
  `https://<api-host>/api/meta/webhook` derived like the OAuth redirect).
  Point it at the deployed host, not the dev workspace.
- Verify token: `META_WEBHOOK_VERIFY_TOKEN` — any random string; the GET
  verification handler compares against it.

Webhook deliveries are verified with `X-Hub-Signature-256` (HMAC over the
raw body using the app secret) and deduplicated by leadgen id — retried
deliveries never create duplicate leads.

## Permissions requested during OAuth

`pages_show_list`, `pages_read_engagement`, `read_insights`,
`instagram_basic`, `instagram_manage_insights`, `ads_read`,
`leads_retrieval`, `pages_manage_ads`, `pages_messaging`,
`business_management`.

While the app is in **Development mode** these work for people with a
role on the app (admin/developer/tester) — enough for EMA's own account.
Public use by other businesses would require Meta App Review.

## How syncing works

- Connecting triggers an immediate full sync (90-day backfill).
- A background worker re-syncs every 45 minutes (7-day refresh window).
- The **Refresh data** button forces a sync on demand.
- Each sync records a run in `meta_sync_runs` with per-section outcomes;
  a failing section (e.g. missing ads permission) never blocks the rest.
- Access tokens are stored AES-256-GCM encrypted; they never reach the
  browser or the logs.

## Leads flow

Meta lead form submissions arrive via webhook (instant) and sync
(catch-up). Each is stored in `meta_leads` and imported into the Leads
Centre (`prelaunch_leads`, source =`meta`) with dedupe by email/WhatsApp —
an existing lead is linked, never duplicated.

## Known limitations

- Meta tokens expire after ~60 days; the dashboard shows a
  **Reconnect needed** banner when that happens.
- Campaign/ad figures are Meta-reported *lifetime* aggregates and are
  labelled as such — they are never mixed with CRM conversion numbers.
- Some metrics aren't exposed by Meta for small accounts (e.g. follower
  demographics need ≥100 followers); the UI shows
  "Metric unavailable through Meta API" instead of fake numbers.
