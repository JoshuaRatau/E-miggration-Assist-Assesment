import { db, prelaunchLeadsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { normalizeWhatsapp } from "../whatsapp";

export type DedupeOutcome =
  | { kind: "none" }
  | { kind: "match"; lead: typeof prelaunchLeadsTable.$inferSelect }
  | {
      kind: "conflict";
      // Two DIFFERENT existing leads were matched — one by email, one by
      // WhatsApp. The caller should treat this as a per-row error rather
      // than guess which one to bind to.
      emailMatchId: string;
      whatsappMatchId: string;
    };

/**
 * Look up an existing prelaunch_leads row that matches the incoming row's
 * contact dimensions. Email is compared lower-cased; WhatsApp is compared
 * after the canonical normaliser (`+E.164` form, no separators) so two
 * cosmetically different inputs collapse to the same row.
 *
 * Disambiguation rules:
 *   - 0 hits                                                  → { kind: "none" }
 *   - 1 hit (or 2 hits that are the same lead)                → { kind: "match" }
 *   - 2 hits referring to DIFFERENT leads                     → { kind: "conflict" }
 *
 * The conflict case is important: "alice@example.com" might already exist on
 * lead A while "+2782…" already exists on lead B. Picking either with a
 * silent LIMIT 1 would corrupt one of them under the `update` strategy —
 * the caller surfaces this as an invalid row instead.
 */
export async function findDuplicateLead(args: {
  email?: string | null;
  whatsapp?: string | null;
}): Promise<DedupeOutcome> {
  const email =
    typeof args.email === "string" && args.email.length > 0
      ? args.email.toLowerCase()
      : null;
  const whatsapp =
    typeof args.whatsapp === "string" && args.whatsapp.length > 0
      ? normalizeWhatsapp(args.whatsapp)
      : null;
  if (!email && !whatsapp) return { kind: "none" };

  // Pull BOTH matches in a single query so we can detect cross-contact
  // conflicts. Cap at 2 — more than that is statistically impossible given
  // both columns are indexed and effectively unique per existing-lead row.
  const orParts = [];
  if (email) orParts.push(eq(prelaunchLeadsTable.email, email));
  if (whatsapp) orParts.push(eq(prelaunchLeadsTable.whatsapp, whatsapp));
  const where = orParts.length > 1 ? or(...orParts) : orParts[0]!;
  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(where)
    .limit(5);

  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "match", lead: rows[0]! };

  // Multiple hits: figure out which is the email-side match and which is
  // the WA-side match. If they collapse to the same lead id we still treat
  // it as a clean match.
  const emailHit = email ? rows.find((r) => r.email === email) ?? null : null;
  const waHit =
    whatsapp ? rows.find((r) => r.whatsapp === whatsapp) ?? null : null;
  if (emailHit && waHit && emailHit.id !== waHit.id) {
    return {
      kind: "conflict",
      emailMatchId: emailHit.id,
      whatsappMatchId: waHit.id,
    };
  }
  // Same row matched by both dimensions, OR only one dimension matched.
  return { kind: "match", lead: emailHit ?? waHit ?? rows[0]! };
}
