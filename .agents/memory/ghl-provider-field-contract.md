---
name: GHL provider field contract
description: Live schema response differences that intercepted fixtures did not reveal.
---

Treat GHL custom-field logical mapping keys, provider-generated keys and request
versus response option formats as separate contracts.

**Why:** The live v3 API returned enum choices as `picklistOptions` after accepting
`options` in creation requests. It also stripped the hyphen from the display name
"EMA WhatsApp Opt-in", generating `contact.ema_whatsapp_optin` rather than the
logical mapping key `contact.ema_whatsapp_opt_in`. Intercepted fixtures had masked
both differences. A successful create must never be repeated just because its
response failed a local validator.

**How to apply:** Journal create attempts/responses before validating responses;
on a mismatch, reconcile the exact created ID and explicitly reuse that field.
Use only documented narrow key aliases, retain exact names/types/options,
and validate setup, controlled testing and production against the same decoder.
Reject conflicting `options`/`picklistOptions` representations.