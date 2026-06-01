---
name: Email forbidden-phrase screen
description: Why some emails silently fail to send in api-server
---

`lib/email.ts` runs every outbound email through `findForbiddenPhrase` (matches
words like "approved", "rejected", "guaranteed", "apply now", etc.). A match
returns `{ok:false}` and the email is NOT sent — by design, to stop the system
making client-facing immigration promises.

**Gotcha:** any email whose subject or body echoes USER-authored free text can be
silently dropped if the user happens to use one of those words. The send "fails"
quietly (logged at error, no exception).

**How to apply:** for INTERNAL/ops notifications carrying user text (e.g. the
support-widget queries), send via `sendInternalNotificationEmail` which sets the
internal `skipPhraseScreen` flag. NEVER skip the screen for client-facing mail.
