---
name: GHL delivery safety decisions
description: Development-only approval boundary and ambiguous remote-write semantics.
---

GHL implementation approval is development-only, with mocked responses and a confirmed isolated database. Production enablement, actual GHL setup/writes and historical backfills need separate approval.

**Why:** The configured token/location may identify real customer infrastructure; credential presence is not consent to write or test against it. Replit is development and AWS is production, but repository deployment notes do not verify the live AWS topology.

**How to apply:** Keep tests off the application database. The user clarified that a real network client and guarded worker/setup wiring are approved development code; the restriction is on executing live writes, not implementing them. Keep enablement off unless separately authorised.

The user has no separate GHL test account. Controlled-live preparation uses the existing live sub-account and exactly three allowlisted lead/submission pairs, one per flow, sharing one user-controlled contact identity; it must never be described as an isolated GHL account.

**Why:** User clarification on 2026-09-21 distinguishes database isolation from GHL account isolation. Duplicate matching is email-first, phone-second with duplicates off, but this does not rule out outbound automations.

**How to apply:** Run separate email/phone collision checks and resolve notification risks before requesting bounded live-write approval. Do not require three distinct contact pairs or store the user's supplied PII in memory. Three harness leads mean three opportunities on one shared contact, not permission to bypass the ordinary forms' duplicate rejection. An in-memory persistence harness proves database isolation, not full HTTP/form E2E or restart durability.

Recipient-specific test-message consent must remain separate from live-write approval and ongoing marketing consent. It never covers staff inboxes, other leads, forwarded notifications, DND overrides or workflow/account changes.

**Why:** The user expressly limited messaging permission to their controlled identity and the three synthetic assessments.

**How to apply:** Do not translate this bounded permission into a permanent WhatsApp marketing opt-in. Independently check whether GHL automations reach other recipients; do not assume that permission to receive messages removes that gate.

Local leases cannot cancel a remote mutation after a timeout. Preserve an unresolved-mutation barrier until reconciliation or operator review establishes safety; never blindly replay creates or allow newer contact writes past an ambiguous older update.

**Why:** A delayed older update can overwrite newer answers after local lease expiry. Provider-shaped contact and opportunity custom-field fixtures differ, so shared decoders can conceal reconciliation failures.

**How to apply:** Keep remote-contract and late-completion regressions when extending delivery. Preserve first-touch attribution separately from each submission's immutable captured attribution.

Do not conflate HighLevel OAuth API authorization, private-token API access and
an authenticated browser session. None alone proves access to workflow action
recipient settings.

**Why:** Generic OAuth-connection advice can stall recipient verification when
the connector exposes CRM APIs but not the required workflow settings.

**How to apply:** Check actual scopes/capabilities before making OAuth completion
a prerequisite. If recipient details are unavailable through the API, request
the next specific GHL UI screen rather than repeating token or login checks.