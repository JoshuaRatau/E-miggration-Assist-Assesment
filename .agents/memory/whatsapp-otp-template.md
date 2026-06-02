---
name: WhatsApp OTP Content Template
description: How the WhatsApp OTP template SID is configured and an env-var/secret collision gotcha that wasted time.
---

# WhatsApp OTP Content Template

The OTP template SID is **never hardcoded** — it is supplied only via the
`TWILIO_WHATSAPP_TEMPLATE_SID` config value, read at call time. When set,
`sendWhatsAppOtp` dispatches via the approved Twilio Content Template
(`contentVariables` = `{"1": code}`); when unset it falls back to free-form
text, which Twilio rejects for first-contact OTP (outside 24h window, error
63016). So "the app is sending the wrong/rejected template" is a config fix,
not a code search-replace.

**Why:** swapping a rejected template for an approved one is done by changing
that config value, not by editing source.

**How to apply:** to change which template OTP uses, set
`TWILIO_WHATSAPP_TEMPLATE_SID` to the new SID and restart the api-server
workflow. Confirm via api-server logs: `whatsapp_template_mode: true` +
"dispatching via approved Twilio Content Template". The sender comes from
`TWILIO_WHATSAPP_FROM`.

## Env-var vs secret collision gotcha (Replit)

If the same key exists BOTH as a "shared" env var and as a secret, deleting the
shared env var via `deleteEnvVars` can wipe the value entirely (the secret read
came back unset afterward). Net effect observed: end up with neither.
**Safe path:** for a non-sensitive identifier like a Content Template SID, just
set it once as a shared env var and leave it — don't try to delete a duplicate
to "clean up". Verify with `viewEnvVars` and a restart before testing.
