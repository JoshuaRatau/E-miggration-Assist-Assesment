# Support Centre → migrated Eride Support Hub

The Support Centre sends requests to EMA's existing `/api/support` endpoint.
EMA saves its local support row, retains its existing email notification, then
forwards the ticket server-to-server to the Support Hub. The Support Hub owns
persistence to its production database; no direct RDS connection or frontend
change is needed in EMA.

The owner supplied `https://support-api.eridetech.africa` as the production API.
A read-only `GET /api/support/products` returned HTTP 200 and one EMA product.
Its ID differs from the old Replit product ID.

## Human-only production configuration

On the **EMA EC2 backend**, set the following using its existing production
environment mechanism:

```text
SUPPORT_HUB_URL=https://support-api.eridetech.africa
```

Remove any obsolete `SUPPORT_HUB_PRODUCT_ID` override (or set it empty) so the
updated code resolves EMA from the new API's product registry. If your existing
operational process requires an explicit product override, use the ID returned
by that registry, never the old Replit ID.

Release the updated backend through the established off-host build and
GitHub/EC2 process, preserving all other environment settings. Restart only
`immigration-api` after configuration and release, using the existing process.
Do not install/build on EC2 or redeploy unrelated services. No new database
migrations are introduced by this support-routing change.

Replit workspace environment changes do **not** update EC2's environment.
Existing downloadable GHL release archives are unchanged and do not contain
this later source correction; do not treat them as an updated support release.

## Verification and boundaries

- Public registry connectivity was checked read-only.
- Mocked tests cover destination, request/response contract, product lookup
  failure and ambiguity, recovery on a later request, and explicit overrides.
- No real ticket was created and no production database was queried or changed.
- After the human release, confirm a genuine incoming support request appears
  in the migrated Support Hub with its returned reference.
- RDS persistence and live ticket creation are not yet verified from this
  workspace; API reachability alone does not prove them.

Unchanged behavior: if forwarding fails, EMA retains its local support row and
still returns success for that local save, without a hub ticket reference. There
is no automatic durable forwarding retry in this route. The new code does not
fall back to the retired Replit hub or its hardcoded product ID. No historical
tickets are moved or replayed by this change.