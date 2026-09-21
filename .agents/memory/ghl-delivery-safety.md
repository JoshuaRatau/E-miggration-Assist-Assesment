---
name: GHL delivery safety decisions
description: Development-only approval boundary and ambiguous remote-write semantics.
---

GHL implementation approval is development-only, with mocked responses and a confirmed isolated database. Production enablement, actual GHL setup/writes and historical backfills need separate approval.

**Why:** The configured token/location may identify real customer infrastructure; credential presence is not consent to write or test against it. Replit is development and AWS is production, but repository deployment notes do not verify the live AWS topology.

**How to apply:** Keep tests off the application database. Do not replace the intentionally blocked live transport or enable production merely to make a demonstration run.

Local leases cannot cancel a remote mutation after a timeout. Preserve an unresolved-mutation barrier until reconciliation or operator review establishes safety; never blindly replay creates or allow newer contact writes past an ambiguous older update.

**Why:** A delayed older update can overwrite newer answers after local lease expiry. Provider-shaped contact and opportunity custom-field fixtures differ, so shared decoders can conceal reconciliation failures.

**How to apply:** Keep remote-contract and late-completion regressions when extending delivery. Preserve first-touch attribution separately from each submission's immutable captured attribution.