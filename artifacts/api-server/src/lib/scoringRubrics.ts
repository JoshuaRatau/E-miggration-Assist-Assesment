/**
 * Phase 6B — Tier-aware lead scoring rubrics.
 *
 * Rules live in code (not DB rows) for V1. The canonical mapping from
 * `intended_tier` to rubric is `pickRubricForTier()`. Each rubric is a
 * flat list of `Rule` entries the recompute worker walks on every tick.
 *
 *   rubricFor(tier).rules.find(r => r.type === eventType).points
 *
 * Rule semantics
 * --------------
 *   type        Matches `lead_events.type`. A given event type may exist
 *               in MORE THAN ONE rubric with different point values
 *               (e.g. `demo_requested` is a high-value sales signal but
 *               a neutral self-serve signal).
 *   points      Added to the lead's running total each time the event
 *               fires, capped per-rule by `maxOccurrences`.
 *   maxOccurrences  Defaults to Infinity. Useful for events that should
 *               only score once (e.g. `lead_created`).
 *   decayDays   If set, the contribution decays linearly to zero across
 *               the window. Defaults to no decay (permanent contribution).
 */

export type RubricName = "self_serve" | "sales" | "static";

export interface Rule {
  type: string;
  points: number;
  maxOccurrences?: number;
  decayDays?: number;
}

export interface Rubric {
  name: RubricName;
  rules: Rule[];
  /** Hard cap on the total score under this rubric. Mirrors the 0-100 UI. */
  cap: number;
}

const SELF_SERVE: Rubric = {
  name: "self_serve",
  cap: 100,
  rules: [
    { type: "lead_created", points: 10, maxOccurrences: 1 },
    { type: "assessment_completed", points: 15, maxOccurrences: 1 },
    { type: "documents_uploaded", points: 10, maxOccurrences: 3 },
    { type: "tier_set", points: 5, maxOccurrences: 1 },
    { type: "pricing_page_viewed", points: 8, maxOccurrences: 5, decayDays: 30 },
    { type: "checkout_started", points: 25, maxOccurrences: 2 },
    // Phase 6C — strongest possible self-serve conversion signal.
    // Caps at 1 because a lead either has an active subscription or
    // doesn't; resubscriptions after a cancel are a separate signal we
    // don't model in V1.
    { type: "subscription_started", points: 30, maxOccurrences: 1 },
    { type: "email_opened", points: 2, maxOccurrences: 10, decayDays: 60 },
    { type: "email_clicked", points: 5, maxOccurrences: 10, decayDays: 60 },
    { type: "wa_replied", points: 8, maxOccurrences: 5, decayDays: 60 },
  ],
};

const SALES: Rubric = {
  name: "sales",
  cap: 100,
  rules: [
    { type: "lead_created", points: 5, maxOccurrences: 1 },
    { type: "assessment_completed", points: 10, maxOccurrences: 1 },
    { type: "documents_uploaded", points: 15, maxOccurrences: 5 },
    { type: "tier_set", points: 5, maxOccurrences: 1 },
    { type: "demo_requested", points: 25, maxOccurrences: 2 },
    { type: "proposal_opened", points: 20, maxOccurrences: 3 },
    { type: "status_advanced", points: 8, maxOccurrences: 8, decayDays: 90 },
    // Phase 6C — B2B subscriptions are higher LTV, so weight harder.
    { type: "subscription_started", points: 40, maxOccurrences: 1 },
    { type: "email_opened", points: 1, maxOccurrences: 20, decayDays: 60 },
    { type: "email_clicked", points: 3, maxOccurrences: 20, decayDays: 60 },
    { type: "wa_replied", points: 6, maxOccurrences: 10, decayDays: 60 },
  ],
};

/**
 * Static rubric — preserves the legacy `deriveLeadScore` behaviour for
 * leads that haven't been classified into a motion yet. The worker still
 * runs over these but its event-list is shorter (only the universal
 * system signals fire), so the resulting score floor is low until the
 * operator picks an intendedTier.
 */
const STATIC: Rubric = {
  name: "static",
  cap: 100,
  rules: [
    { type: "lead_created", points: 10, maxOccurrences: 1 },
    { type: "assessment_completed", points: 15, maxOccurrences: 1 },
    { type: "documents_uploaded", points: 10, maxOccurrences: 3 },
    { type: "status_advanced", points: 5, maxOccurrences: 8, decayDays: 90 },
    // Phase 6C — even untyped leads earn for a paid subscription.
    { type: "subscription_started", points: 20, maxOccurrences: 1 },
    { type: "email_opened", points: 1, maxOccurrences: 10, decayDays: 60 },
    { type: "email_clicked", points: 3, maxOccurrences: 10, decayDays: 60 },
    { type: "wa_replied", points: 5, maxOccurrences: 5, decayDays: 60 },
  ],
};

const RUBRICS: Record<RubricName, Rubric> = {
  self_serve: SELF_SERVE,
  sales: SALES,
  static: STATIC,
};

/** Tier → rubric routing. Mirrors the 3-motion taxonomy in lib/intendedTier.ts. */
const SELF_SERVE_TIERS = new Set([
  "free",
  "basic",
  "plus",
  "pro",
  "premium",
]);
const SALES_TIERS = new Set([
  "starter_firm",
  "growth_firm",
  "scale_firm",
  "enterprise",
  "concierge",
]);

export function pickRubricForTier(
  intendedTier: string | null | undefined,
): RubricName {
  if (!intendedTier || intendedTier === "unknown") return "static";
  if (SELF_SERVE_TIERS.has(intendedTier)) return "self_serve";
  if (SALES_TIERS.has(intendedTier)) return "sales";
  return "static";
}

export function getRubric(name: RubricName): Rubric {
  return RUBRICS[name];
}

/** Used at recordLeadEvent time — looks up the canonical points for a (rubric, type) pair. */
export function pointsFor(rubric: RubricName, eventType: string): number {
  const r = RUBRICS[rubric];
  const rule = r.rules.find((x) => x.type === eventType);
  return rule?.points ?? 0;
}
