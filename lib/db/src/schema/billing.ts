import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// Phase 6C — Inbound revenue ingestion.
//
// The eMigration immigration platform owns subscription + payment
// processing (via Paystack); this CRM only mirrors those events for
// review and analysis. None of these tables are written from any
// public assessment route — the sole writer is the inbound webhook
// `POST /api/webhooks/emigration-billing` (HMAC-signed by the
// eMigration platform with `EMIGRATION_WEBHOOK_SECRET`).
//
// `lead_id` is a soft-ref (no FK) on every table — payments may
// arrive before we've correlated them to a lead, in which case the
// row sits with `lead_id = NULL` and the raw payload is also written
// to `billing_unmatched` for the manual reconciliation queue.

/**
 * One row per active OR historical subscription. `external_subscription_id`
 * is the eMigration platform's identifier (typically the Paystack
 * subscription code) and is the idempotency key for `subscription.*`
 * webhook events.
 */
export const billingSubscriptionsTable = pgTable(
  "billing_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id"),
    externalSubscriptionId: text("external_subscription_id").notNull().unique(),
    // Tier code from `lib/intendedTier.ts` (e.g. `basic`, `growth_firm`).
    // NOT validated at the DB layer so adding a tier doesn't need a
    // migration; the API layer validates against the canonical list.
    planCode: text("plan_code").notNull(),
    planCurrency: text("plan_currency").notNull(), // ZAR | USD
    planAmountCents: integer("plan_amount_cents").notNull(),
    interval: text("interval").notNull(), // monthly | yearly
    // active | trialing | past_due | cancelled | paused | incomplete
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    leadIdx: index("billing_subscriptions_lead_idx").on(t.leadId),
    statusIdx: index("billing_subscriptions_status_idx").on(t.status),
  }),
);

/**
 * One row per payment event (success, failure, refund). Linked to a
 * subscription when applicable (one-off charges may have NULL
 * `subscription_id`). `external_payment_id` is the idempotency key for
 * `payment.*` webhook events.
 */
export const billingPaymentsTable = pgTable(
  "billing_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id"),
    subscriptionId: uuid("subscription_id"),
    externalPaymentId: text("external_payment_id").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(), // success | failed | refunded
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    leadIdx: index("billing_payments_lead_idx").on(t.leadId),
    subIdx: index("billing_payments_sub_idx").on(t.subscriptionId),
    paidAtIdx: index("billing_payments_paid_at_idx").on(t.paidAt),
  }),
);

/**
 * Append-only audit + idempotency log for every webhook event we accept.
 * `external_event_id` is UNIQUE — re-delivery from the eMigration platform
 * is detected at INSERT time and the handler short-circuits.
 *
 * `status`:
 *   - processed: handler ran cleanly, lead correlation succeeded
 *   - unmatched: handler ran but lead correlation failed (also wrote a row
 *                to `billing_unmatched` for the reconciliation queue)
 *   - errored:   handler threw (raw payload preserved here for replay)
 */
export const billingIngestEventsTable = pgTable(
  "billing_ingest_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalEventId: text("external_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull(),
    leadId: uuid("lead_id"),
    errorMessage: text("error_message"),
  },
  (t) => ({
    typeIdx: index("billing_ingest_events_type_idx").on(t.eventType),
    receivedAtIdx: index("billing_ingest_events_received_at_idx").on(
      t.receivedAt,
    ),
  }),
);

/**
 * Reconciliation queue. Populated when a webhook event cannot be
 * correlated to any lead by `lead_reference` or by email. An operator
 * resolves the row from `/admin/billing` by picking a lead, which fills
 * `resolved_at` + `resolved_by_lead_id` and back-fills the linked
 * subscription / payment rows.
 */
export const billingUnmatchedTable = pgTable("billing_unmatched", {
  id: uuid("id").primaryKey().defaultRandom(),
  ingestEventId: uuid("ingest_event_id").notNull(),
  attemptedMatchKeys: jsonb("attempted_match_keys").notNull(),
  rawPayload: jsonb("raw_payload").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByLeadId: uuid("resolved_by_lead_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BillingSubscription = typeof billingSubscriptionsTable.$inferSelect;
export type InsertBillingSubscription =
  typeof billingSubscriptionsTable.$inferInsert;
export type BillingPayment = typeof billingPaymentsTable.$inferSelect;
export type InsertBillingPayment = typeof billingPaymentsTable.$inferInsert;
export type BillingIngestEvent = typeof billingIngestEventsTable.$inferSelect;
export type BillingUnmatched = typeof billingUnmatchedTable.$inferSelect;
