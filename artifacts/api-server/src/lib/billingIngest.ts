/**
 * Phase 6C — Inbound revenue ingestion helpers.
 *
 * The single writer of the `billing_*` tables. Every function here is
 * called from `routes/billingWebhook.ts` and nowhere else. Three
 * responsibilities:
 *
 *  1. **HMAC verification** of the inbound request body using
 *     `EMIGRATION_WEBHOOK_SECRET`.
 *  2. **Correlation cascade**: lead_reference → email → unmatched.
 *  3. **Per-event handlers** that write the appropriate billing row,
 *     fire scoring events into the Phase 6B stream, and (on first
 *     successful payment) auto-convert the lead.
 *
 * Idempotency is handled by the route via `billing_ingest_events`
 * UNIQUE on `external_event_id`; handlers therefore assume they are
 * running at-most-once per event.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  prelaunchLeadsTable,
  billingSubscriptionsTable,
  billingPaymentsTable,
  billingUnmatchedTable,
  billingIngestEventsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { ensureCaseForLead } from "./cases";
import { recordLeadEvent } from "./recordLeadEvent";
import { writeAudit } from "./audit";
import type { Request } from "express";

// ---------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------

/**
 * Constant-time HMAC verification. The eMigration platform signs the raw
 * request body with HMAC-SHA256 using the shared secret and sends the
 * hex digest in `X-Emigration-Signature` (optional `sha256=` prefix
 * tolerated for compatibility with common signing libraries).
 *
 * Returns `false` for any of: missing secret, missing/empty header,
 * malformed hex, length mismatch, signature mismatch. Callers must
 * treat `false` as a hard 401 — never log the actual signature value.
 */
export function verifyEmigrationSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !rawBody || !signatureHeader) return false;

  // Strip the optional `sha256=` prefix so callers can use either style.
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const expected = createHmac("sha256", secret).update(body).digest("hex");

  if (provided.length !== expected.length) return false;
  // timingSafeEqual requires identical lengths (guarded above).
  return timingSafeEqual(
    Buffer.from(provided.toLowerCase(), "hex"),
    Buffer.from(expected, "hex"),
  );
}

// ---------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------

export interface CorrelationAttempt {
  leadReference?: string | null;
  email?: string | null;
}

export interface CorrelationResult {
  leadId: string | null;
  matchedBy: "lead_reference" | "email" | null;
  attempted: CorrelationAttempt;
}

/**
 * Try to find a lead for a billing event. Cascade:
 *   1. `lead_reference` (exact, case-insensitive on the EMA-XXXX format)
 *   2. `email` (case-insensitive, trimmed)
 *
 * Returns `{leadId: null}` when neither key is present or matches; the
 * caller is responsible for routing the event to `billing_unmatched`.
 */
export async function correlateLead(
  attempt: CorrelationAttempt,
): Promise<CorrelationResult> {
  const ref = attempt.leadReference?.trim();
  const email = attempt.email?.trim().toLowerCase();

  if (ref) {
    const [row] = await db
      .select({ id: prelaunchLeadsTable.id })
      .from(prelaunchLeadsTable)
      .where(
        sql`upper(${prelaunchLeadsTable.referenceNumber}) = upper(${ref})`,
      )
      .limit(1);
    if (row) {
      return {
        leadId: row.id,
        matchedBy: "lead_reference",
        attempted: { leadReference: ref, email: email ?? null },
      };
    }
  }

  if (email) {
    const [row] = await db
      .select({ id: prelaunchLeadsTable.id })
      .from(prelaunchLeadsTable)
      .where(sql`lower(${prelaunchLeadsTable.email}) = ${email}`)
      .limit(1);
    if (row) {
      return {
        leadId: row.id,
        matchedBy: "email",
        attempted: { leadReference: ref ?? null, email },
      };
    }
  }

  return {
    leadId: null,
    matchedBy: null,
    attempted: { leadReference: ref ?? null, email: email ?? null },
  };
}

// ---------------------------------------------------------------------
// Inbound payload contract (Zod-enforced at the route layer)
// ---------------------------------------------------------------------

export type BillingEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface BillingEventEnvelope {
  /** UNIQUE on the eMigration side; our idempotency key. */
  id: string;
  type: BillingEventType;
  /** ISO-8601. The eMigration platform's authoritative event time. */
  occurredAt: string;
  /** Correlation hints. At least one must be present for a hit. */
  leadReference?: string | null;
  email?: string | null;
  data: SubscriptionPayload | PaymentPayload;
}

export interface SubscriptionPayload {
  externalSubscriptionId: string;
  planCode: string; // matches `intendedTier`
  planCurrency: "ZAR" | "USD";
  planAmountCents: number;
  interval: "monthly" | "yearly";
  status: string;
  startedAt: string;
  currentPeriodEnd?: string | null;
  cancelledAt?: string | null;
}

export interface PaymentPayload {
  externalPaymentId: string;
  externalSubscriptionId?: string | null;
  amountCents: number;
  currency: "ZAR" | "USD";
  paidAt: string;
  status: "success" | "failed" | "refunded";
}

// ---------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------

/**
 * Insert/update a subscription row. Uses `external_subscription_id` as
 * the conflict target so `subscription.created` and follow-up
 * `subscription.updated` events both land in the same row.
 */
export async function upsertSubscription(args: {
  leadId: string | null;
  payload: SubscriptionPayload;
  raw: unknown;
}): Promise<{ subscriptionId: string; created: boolean }> {
  const { payload } = args;
  const [inserted] = await db
    .insert(billingSubscriptionsTable)
    .values({
      leadId: args.leadId,
      externalSubscriptionId: payload.externalSubscriptionId,
      planCode: payload.planCode,
      planCurrency: payload.planCurrency,
      planAmountCents: payload.planAmountCents,
      interval: payload.interval,
      status: payload.status,
      startedAt: new Date(payload.startedAt),
      currentPeriodEnd: payload.currentPeriodEnd
        ? new Date(payload.currentPeriodEnd)
        : null,
      cancelledAt: payload.cancelledAt ? new Date(payload.cancelledAt) : null,
      rawPayload: args.raw as never,
    })
    .onConflictDoUpdate({
      target: billingSubscriptionsTable.externalSubscriptionId,
      set: {
        // lead_id is intentionally NOT overwritten on update — once we've
        // correlated a sub to a lead, a later partially-correlated update
        // event must not unset the link.
        planCode: payload.planCode,
        planCurrency: payload.planCurrency,
        planAmountCents: payload.planAmountCents,
        interval: payload.interval,
        status: payload.status,
        currentPeriodEnd: payload.currentPeriodEnd
          ? new Date(payload.currentPeriodEnd)
          : null,
        cancelledAt: payload.cancelledAt ? new Date(payload.cancelledAt) : null,
        rawPayload: args.raw as never,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: billingSubscriptionsTable.id,
      // Drizzle doesn't expose an "xmax=0 means insert" flag; we read the
      // createdAt vs updatedAt skew instead. Within the same statement,
      // an INSERT path leaves them equal; an UPDATE path bumps updatedAt.
      createdAt: billingSubscriptionsTable.createdAt,
      updatedAt: billingSubscriptionsTable.updatedAt,
    });

  if (!inserted) {
    throw new Error("upsertSubscription: no row returned");
  }
  return {
    subscriptionId: inserted.id,
    created: inserted.createdAt.getTime() === inserted.updatedAt.getTime(),
  };
}

/**
 * Insert a payment row. Returns `{ paymentId, alreadyRecorded }` —
 * `alreadyRecorded` is `true` when the unique constraint on
 * `external_payment_id` short-circuited the insert (re-delivery).
 *
 * Looks up the subscription FK via `externalSubscriptionId` so the
 * caller doesn't need to thread it.
 */
export async function recordPayment(args: {
  leadId: string | null;
  payload: PaymentPayload;
  raw: unknown;
}): Promise<{ paymentId: string | null; alreadyRecorded: boolean }> {
  const { payload } = args;

  let subscriptionId: string | null = null;
  if (payload.externalSubscriptionId) {
    const [sub] = await db
      .select({ id: billingSubscriptionsTable.id })
      .from(billingSubscriptionsTable)
      .where(
        eq(
          billingSubscriptionsTable.externalSubscriptionId,
          payload.externalSubscriptionId,
        ),
      )
      .limit(1);
    subscriptionId = sub?.id ?? null;
  }

  const [inserted] = await db
    .insert(billingPaymentsTable)
    .values({
      leadId: args.leadId,
      subscriptionId,
      externalPaymentId: payload.externalPaymentId,
      amountCents: payload.amountCents,
      currency: payload.currency,
      paidAt: new Date(payload.paidAt),
      status: payload.status,
      rawPayload: args.raw as never,
    })
    .onConflictDoNothing({
      target: billingPaymentsTable.externalPaymentId,
    })
    .returning({ id: billingPaymentsTable.id });

  if (inserted) return { paymentId: inserted.id, alreadyRecorded: false };
  return { paymentId: null, alreadyRecorded: true };
}

/**
 * Auto-conversion: on the first successful payment for a lead, advance
 * `lead_status` to `converted` and ensure a `lead_cases` row exists.
 *
 * Bypasses the operator-only "must be in ready_for_case to convert"
 * invariant — that guard prevents operators from accidentally skipping
 * the funnel; an inbound payment is hard evidence of conversion and is
 * a legitimate system-driven override.
 *
 * Idempotent: if the lead is already `converted`, returns early without
 * writing anything. Concurrency-safe via `ensureCaseForLead`'s atomic
 * INSERT … ON CONFLICT.
 *
 * Returns `true` when this call performed the conversion (so the caller
 * can fire the appropriate scoring event), `false` otherwise.
 */
export async function autoConvertLeadOnFirstPayment(
  leadId: string,
  log: Pick<typeof logger, "info" | "warn"> = logger,
): Promise<boolean> {
  // Atomic conditional update — flip only if currently NOT converted.
  // The WHERE predicate guarantees that two concurrent webhook deliveries
  // cannot both observe the same "before" state.
  const [updated] = await db
    .update(prelaunchLeadsTable)
    .set({ leadStatus: "converted", updatedAt: sql`now()` })
    .where(
      and(
        eq(prelaunchLeadsTable.id, leadId),
        sql`${prelaunchLeadsTable.leadStatus} <> 'converted'`,
      ),
    )
    .returning({
      id: prelaunchLeadsTable.id,
      referenceNumber: prelaunchLeadsTable.referenceNumber,
      previousStatus: sql<string>`'web_hook_auto_convert'`.as("previous_marker"),
    });

  if (!updated) {
    return false;
  }

  // Atomic INSERT … ON CONFLICT. Always called so we surface a caseId
  // on the audit row even if a sibling process already created it.
  try {
    await ensureCaseForLead(updated.id, updated.referenceNumber);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), leadId },
      "auto-convert: ensureCaseForLead threw — lead is converted but case row missing",
    );
  }

  log.info(
    { leadId, referenceNumber: updated.referenceNumber },
    "auto-convert: lead advanced to converted on first successful payment",
  );
  return true;
}

/**
 * Unmatched-event router. Writes a row to `billing_unmatched` with the
 * raw payload + the keys we tried, so an operator can resolve from
 * `/admin/billing` later. Caller has already written the parent
 * `billing_ingest_events` row (status='unmatched').
 */
export async function recordUnmatched(args: {
  ingestEventId: string;
  attempted: CorrelationAttempt;
  raw: unknown;
}): Promise<void> {
  await db.insert(billingUnmatchedTable).values({
    ingestEventId: args.ingestEventId,
    attemptedMatchKeys: args.attempted as never,
    rawPayload: args.raw as never,
  });
}

// ---------------------------------------------------------------------
// Top-level dispatch (called once per verified event)
// ---------------------------------------------------------------------

export interface DispatchResult {
  status: "processed" | "unmatched" | "errored";
  leadId: string | null;
  errorMessage?: string;
  /** True when handler decided to skip writes (e.g. already-recorded payment). */
  skipped?: boolean;
}

export async function dispatchBillingEvent(args: {
  envelope: BillingEventEnvelope;
  raw: unknown;
  ingestEventId: string;
  req: Request;
}): Promise<DispatchResult> {
  const { envelope, raw, ingestEventId, req } = args;

  const correlation = await correlateLead({
    leadReference: envelope.leadReference ?? null,
    email: envelope.email ?? null,
  });

  // Unmatched: write a billing_unmatched row, return without dispatching
  // to a handler. Even when unmatched, we still record the subscription /
  // payment row when the event is structural (so revenue is never lost
  // — it's just unattributed until reconciliation).
  if (!correlation.leadId) {
    await recordUnmatched({
      ingestEventId,
      attempted: correlation.attempted,
      raw,
    });
    // Continue to record the structural row with leadId=NULL so the
    // revenue is captured even before reconciliation.
  }

  try {
    if (
      envelope.type === "subscription.created" ||
      envelope.type === "subscription.updated"
    ) {
      const payload = envelope.data as SubscriptionPayload;
      const { created } = await upsertSubscription({
        leadId: correlation.leadId,
        payload,
        raw,
      });

      if (created && correlation.leadId) {
        // Phase 6B scoring hook — first time we see this subscription
        // and we know the lead. `subscription.updated` for the same sub
        // won't re-fire because `created` is false on the UPDATE path.
        void recordLeadEvent({
          leadId: correlation.leadId,
          type: "subscription_started",
          source: "webhook",
          payload: {
            externalSubscriptionId: payload.externalSubscriptionId,
            planCode: payload.planCode,
            planCurrency: payload.planCurrency,
            planAmountCents: payload.planAmountCents,
          },
        });
      }
      return {
        status: correlation.leadId ? "processed" : "unmatched",
        leadId: correlation.leadId,
      };
    }

    if (envelope.type === "subscription.cancelled") {
      const payload = envelope.data as SubscriptionPayload;
      await upsertSubscription({
        leadId: correlation.leadId,
        payload: { ...payload, status: "cancelled" },
        raw,
      });
      return {
        status: correlation.leadId ? "processed" : "unmatched",
        leadId: correlation.leadId,
      };
    }

    if (
      envelope.type === "payment.succeeded" ||
      envelope.type === "payment.failed" ||
      envelope.type === "payment.refunded"
    ) {
      const payload = envelope.data as PaymentPayload;
      const { alreadyRecorded } = await recordPayment({
        leadId: correlation.leadId,
        payload,
        raw,
      });
      if (alreadyRecorded) {
        return {
          status: correlation.leadId ? "processed" : "unmatched",
          leadId: correlation.leadId,
          skipped: true,
        };
      }

      // Auto-convert on first successful payment. The
      // `autoConvertLeadOnFirstPayment` helper is itself idempotent —
      // returns false if the lead is already converted.
      if (envelope.type === "payment.succeeded" && correlation.leadId) {
        const converted = await autoConvertLeadOnFirstPayment(
          correlation.leadId,
          req.log,
        );
        if (converted) {
          void writeAudit({
            req,
            action: "lead_status_changed",
            leadId: correlation.leadId,
            before: { leadStatus: null }, // sentinel: webhook-driven, before-state not snapshotted
            after: { leadStatus: "converted" },
          });
          void writeAudit({
            req,
            action: "lead_converted",
            leadId: correlation.leadId,
            before: { leadStatus: null, caseId: null },
            after: { leadStatus: "converted", source: "webhook" },
          });
          void recordLeadEvent({
            leadId: correlation.leadId,
            type: "status_advanced",
            source: "webhook",
            payload: { to: "converted", reason: "auto_convert_on_payment" },
          });
        }
      }

      return {
        status: correlation.leadId ? "processed" : "unmatched",
        leadId: correlation.leadId,
      };
    }

    // Should be unreachable — Zod at the route layer rejects unknown types.
    return {
      status: "errored",
      leadId: correlation.leadId,
      errorMessage: `Unknown event type: ${(envelope as { type: string }).type}`,
    };
  } catch (err) {
    return {
      status: "errored",
      leadId: correlation.leadId,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reserve a slot in `billing_ingest_events` for this event id. Three
 * possible outcomes:
 *
 *   - `inserted`: brand-new event id. Caller proceeds to dispatch.
 *   - `replay`:   the event was previously attempted but did NOT reach
 *                 a terminal-success state (status in 'processing' or
 *                 'errored'). The row id is returned and the caller
 *                 must re-run dispatch — the final `finaliseIngestEvent`
 *                 UPDATE will overwrite the prior outcome on the same
 *                 row. This is what makes provider retries actually
 *                 retry instead of being silently swallowed.
 *   - `terminal`: the event already reached a terminal-success state
 *                 (processed/unmatched). Caller short-circuits 200
 *                 `{already_processed:true}`.
 *
 * The row is inserted as `status='processing'` so a crash between
 * reserve and finalise leaves the event in a re-runnable state on the
 * next provider retry — never poisoned as "already processed".
 */
export type ReservationOutcome = "inserted" | "replay" | "terminal";
export interface ReservationResult {
  id: string | null;
  outcome: ReservationOutcome;
}

const TERMINAL_SUCCESS_STATUSES = new Set(["processed", "unmatched"]);

export async function reserveIngestEvent(args: {
  externalEventId: string;
  eventType: string;
}): Promise<ReservationResult> {
  const [inserted] = await db
    .insert(billingIngestEventsTable)
    .values({
      externalEventId: args.externalEventId,
      eventType: args.eventType,
      status: "processing", // overwritten by finaliseIngestEvent on success
    })
    .onConflictDoNothing({
      target: billingIngestEventsTable.externalEventId,
    })
    .returning({ id: billingIngestEventsTable.id });

  if (inserted) return { id: inserted.id, outcome: "inserted" };

  // Conflict path — fetch the prior attempt's status.
  const [existing] = await db
    .select({
      id: billingIngestEventsTable.id,
      status: billingIngestEventsTable.status,
    })
    .from(billingIngestEventsTable)
    .where(eq(billingIngestEventsTable.externalEventId, args.externalEventId))
    .limit(1);

  if (!existing) {
    // Race-loss: the conflicting row was deleted between our INSERT and
    // SELECT. Treat as a fresh attempt by re-trying the insert once.
    const [retry] = await db
      .insert(billingIngestEventsTable)
      .values({
        externalEventId: args.externalEventId,
        eventType: args.eventType,
        status: "processing",
      })
      .onConflictDoNothing({
        target: billingIngestEventsTable.externalEventId,
      })
      .returning({ id: billingIngestEventsTable.id });
    if (retry) return { id: retry.id, outcome: "inserted" };
    // Truly racing — surface as a transient failure so the provider retries.
    return { id: null, outcome: "replay" };
  }

  if (TERMINAL_SUCCESS_STATUSES.has(existing.status)) {
    return { id: existing.id, outcome: "terminal" };
  }
  // 'processing' (in-flight or crashed mid-dispatch) or 'errored'
  // (handler threw on a previous attempt) — both mean we should re-run.
  return { id: existing.id, outcome: "replay" };
}

export async function finaliseIngestEvent(args: {
  id: string;
  status: "processed" | "unmatched" | "errored";
  leadId: string | null;
  errorMessage?: string;
}): Promise<void> {
  await db
    .update(billingIngestEventsTable)
    .set({
      status: args.status,
      leadId: args.leadId,
      errorMessage: args.errorMessage ?? null,
    })
    .where(eq(billingIngestEventsTable.id, args.id));
}
