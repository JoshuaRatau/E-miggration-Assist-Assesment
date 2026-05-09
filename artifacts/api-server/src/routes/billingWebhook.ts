/**
 * Phase 6C — Inbound billing webhook from the eMigration immigration
 * platform.
 *
 * `POST /api/webhooks/emigration-billing`
 *
 * Posture mirrors the WhatsApp webhook (`whatsappWebhook.ts`):
 *   - Fail-closed on missing secret (503 — loud misconfig).
 *   - 401 on missing/invalid signature, no row written.
 *   - Idempotent on `external_event_id`; re-delivery returns
 *     200 `{already_processed: true}`.
 *   - Persist BEFORE ack: by the time we 200 the event has either
 *     landed in `billing_*` tables or been queued in
 *     `billing_unmatched` for manual reconciliation.
 *
 * Signature scheme: `X-Emigration-Signature: sha256=<hex>` over the
 * raw request body, computed with `EMIGRATION_WEBHOOK_SECRET`. The
 * `sha256=` prefix is optional — some signing libraries emit just the
 * hex digest.
 */

import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import {
  verifyEmigrationSignature,
  reserveIngestEvent,
  finaliseIngestEvent,
  dispatchBillingEvent,
  type BillingEventEnvelope,
} from "../lib/billingIngest";

const router: IRouter = Router();

// ---------------------------------------------------------------------
// Inbound contract — Zod-enforced. The shapes must match
// `BillingEventEnvelope` / `SubscriptionPayload` / `PaymentPayload`
// exactly; if you add a field here, update the OpenAPI spec too so
// the eMigration team's clients stay in sync.
// ---------------------------------------------------------------------

const SubscriptionPayloadSchema = z.object({
  externalSubscriptionId: z.string().min(1).max(255),
  planCode: z.string().min(1).max(64),
  planCurrency: z.enum(["ZAR", "USD"]),
  planAmountCents: z.number().int().nonnegative(),
  interval: z.enum(["monthly", "yearly"]),
  status: z.string().min(1).max(32),
  startedAt: z.string().datetime({ offset: true }),
  currentPeriodEnd: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
  cancelledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const PaymentPayloadSchema = z.object({
  externalPaymentId: z.string().min(1).max(255),
  externalSubscriptionId: z.string().min(1).max(255).nullable().optional(),
  amountCents: z.number().int().nonnegative(),
  currency: z.enum(["ZAR", "USD"]),
  paidAt: z.string().datetime({ offset: true }),
  status: z.enum(["success", "failed", "refunded"]),
});

const SUBSCRIPTION_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
] as const;
const PAYMENT_TYPES = [
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
] as const;

// Strict (type, data.status) cross-field map. Auto-convert keys off
// envelope.type, so a `payment.succeeded` envelope carrying
// `data.status='failed'` MUST be rejected at the validation layer —
// otherwise a malformed payload could trigger a false conversion.
const PAYMENT_TYPE_STATUS_MAP: Record<string, "success" | "failed" | "refunded"> =
  {
    "payment.succeeded": "success",
    "payment.failed": "failed",
    "payment.refunded": "refunded",
  };

const EnvelopeSchema = z
  .object({
    id: z.string().min(1).max(255),
    type: z.enum([...SUBSCRIPTION_TYPES, ...PAYMENT_TYPES]),
    occurredAt: z.string().datetime({ offset: true }),
    leadReference: z.string().min(1).max(64).nullable().optional(),
    email: z.string().email().max(254).nullable().optional(),
    data: z.unknown(),
  })
  .superRefine((env, ctx) => {
    const isSubType = (
      SUBSCRIPTION_TYPES as readonly string[]
    ).includes(env.type);
    const schema = isSubType ? SubscriptionPayloadSchema : PaymentPayloadSchema;
    const parsed = schema.safeParse(env.data);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }

    // Cross-field consistency — payment events must carry a
    // status that matches the envelope type, else reject. Prevents a
    // forged/malformed `payment.succeeded` with `status='failed'` from
    // triggering auto-convert.
    if (!isSubType) {
      const expected = PAYMENT_TYPE_STATUS_MAP[env.type];
      const actual = (parsed.data as { status: string }).status;
      if (expected && actual !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", "status"],
          message: `data.status="${actual}" is incompatible with type="${env.type}" (expected "${expected}")`,
        });
      }
    }

    // `subscription.cancelled` envelope must carry `status='cancelled'`
    // — the handler force-overrides it anyway, but explicit validation
    // surfaces upstream bugs in the eMigration platform's emitter.
    if (isSubType && env.type === "subscription.cancelled") {
      const actual = (parsed.data as { status: string }).status;
      if (actual !== "cancelled") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", "status"],
          message: `data.status="${actual}" is incompatible with type="subscription.cancelled" (expected "cancelled")`,
        });
      }
    }
  });

router.post("/webhooks/emigration-billing", async (req, res) => {
  try {
    const secret = (process.env["EMIGRATION_WEBHOOK_SECRET"] ?? "").trim();
    if (!secret) {
      req.log.error(
        "EMIGRATION_WEBHOOK_SECRET env var is not set; rejecting billing " +
          "webhook with 503 — cannot verify authenticity",
      );
      return res
        .status(503)
        .json({ error: "Billing webhook is not configured" });
    }

    const sig = req.header("x-emigration-signature");
    if (!sig) {
      req.log.warn(
        { ip: req.ip },
        "billing webhook missing X-Emigration-Signature header — rejecting",
      );
      return res.status(401).json({ error: "Missing signature" });
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      // Should be unreachable — `app.ts` captures rawBody on every
      // application/json request. If it's missing, fail rather than
      // silently accept an unverifiable body.
      req.log.error(
        "billing webhook: rawBody not captured — express.json `verify` may be misconfigured",
      );
      return res.status(500).json({ error: "Internal verification error" });
    }

    if (!verifyEmigrationSignature(rawBody, sig, secret)) {
      req.log.warn(
        { ip: req.ip },
        "billing webhook signature verification failed — rejecting (no event stored)",
      );
      return res.status(401).json({ error: "Invalid signature" });
    }

    const parsed = EnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn(
        { issues: parsed.error.issues },
        "billing webhook payload failed validation",
      );
      return res
        .status(400)
        .json({ error: "Invalid payload", details: parsed.error.issues });
    }
    const envelope = parsed.data as BillingEventEnvelope;

    // Idempotency: reserve the event id BEFORE handing off to the
    // dispatcher. The reservation distinguishes 3 outcomes:
    //   - inserted: brand-new event, proceed to dispatch.
    //   - replay:   prior attempt is in-flight ('processing') or
    //               errored — re-run dispatch on the SAME row so a
    //               provider retry actually recovers.
    //   - terminal: prior attempt reached a terminal-success state
    //               (processed/unmatched) — short-circuit 200.
    const reservation = await reserveIngestEvent({
      externalEventId: envelope.id,
      eventType: envelope.type,
    });
    if (reservation.outcome === "terminal") {
      req.log.info(
        { externalEventId: envelope.id },
        "billing webhook re-delivery on already-terminal event — short-circuiting",
      );
      return res.status(200).json({ already_processed: true });
    }
    if (!reservation.id) {
      // Pure-race fallback from reserveIngestEvent — return 503 so the
      // provider retries with backoff instead of failing permanently.
      req.log.warn(
        { externalEventId: envelope.id },
        "billing webhook: failed to acquire ingest reservation — asking provider to retry",
      );
      return res
        .status(503)
        .json({ error: "Reservation race; please retry" });
    }
    if (reservation.outcome === "replay") {
      req.log.info(
        { externalEventId: envelope.id, ingestEventId: reservation.id },
        "billing webhook: replaying prior non-terminal attempt",
      );
    }

    const result = await dispatchBillingEvent({
      envelope,
      raw: req.body,
      ingestEventId: reservation.id,
      req,
    });

    await finaliseIngestEvent({
      id: reservation.id,
      status: result.status,
      leadId: result.leadId,
      errorMessage: result.errorMessage,
    });

    if (result.status === "errored") {
      req.log.error(
        {
          externalEventId: envelope.id,
          eventType: envelope.type,
          err: result.errorMessage,
        },
        "billing webhook dispatch errored — row preserved for replay",
      );
      // Return 500 so the eMigration platform can decide to retry.
      // The ingest_events row keeps the audit trail either way.
      return res.status(500).json({ error: "Dispatch failed" });
    }

    return res.status(200).json({
      ok: true,
      status: result.status,
      leadId: result.leadId,
      ...(result.skipped ? { skipped: true } : {}),
    });
  } catch (err) {
    req.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "billing webhook unexpected error",
    );
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
