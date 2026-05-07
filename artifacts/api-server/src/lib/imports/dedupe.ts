import { db, prelaunchLeadsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { normalizeWhatsapp } from "../whatsapp";

export type DedupeOutcome =
  | { kind: "none" }
  | { kind: "match"; lead: typeof prelaunchLeadsTable.$inferSelect }
  | {
      kind: "conflict";
      // Two DIFFERENT existing leads were matched on different contact
      // dimensions. The caller should treat this as a per-row error rather
      // than guess which one to bind to. The two ids surfaced are the
      // first pair found to disagree.
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
  // Professional-lead contact dimensions. Stored on dedicated columns
  // (`representative_email`, `representative_phone`) — NOT on `email` /
  // `whatsapp` — so dedupe must look at them too or B2B re-imports will
  // silently duplicate firms.
  representativeEmail?: string | null;
  representativePhone?: string | null;
}): Promise<DedupeOutcome> {
  const email =
    typeof args.email === "string" && args.email.length > 0
      ? args.email.toLowerCase()
      : null;
  const whatsapp =
    typeof args.whatsapp === "string" && args.whatsapp.length > 0
      ? normalizeWhatsapp(args.whatsapp)
      : null;
  const repEmail =
    typeof args.representativeEmail === "string" &&
    args.representativeEmail.length > 0
      ? args.representativeEmail.toLowerCase()
      : null;
  const repPhone =
    typeof args.representativePhone === "string" &&
    args.representativePhone.length > 0
      ? normalizeWhatsapp(args.representativePhone)
      : null;
  if (!email && !whatsapp && !repEmail && !repPhone) return { kind: "none" };

  // Pull all matches in a single query so we can detect cross-dimension
  // conflicts. Cap at 5 — more than that is statistically impossible given
  // every contact column is effectively unique per row.
  const orParts = [];
  if (email) orParts.push(eq(prelaunchLeadsTable.email, email));
  if (whatsapp) orParts.push(eq(prelaunchLeadsTable.whatsapp, whatsapp));
  if (repEmail)
    orParts.push(eq(prelaunchLeadsTable.representativeEmail, repEmail));
  if (repPhone)
    orParts.push(eq(prelaunchLeadsTable.representativePhone, repPhone));
  const where = orParts.length > 1 ? or(...orParts) : orParts[0]!;
  const rows = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(where)
    .limit(5);

  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1) return { kind: "match", lead: rows[0]! };

  // Multiple hits across dimensions. Collapse by id; if every hit is the
  // same lead we still treat it as a clean match.
  const distinctIds = new Set(rows.map((r) => r.id));
  if (distinctIds.size === 1) return { kind: "match", lead: rows[0]! };
  // Two or more genuinely distinct leads matched on different dimensions —
  // surface as a conflict so the operator can resolve manually rather than
  // silently bind/overwrite the wrong row.
  const [a, b] = rows;
  return {
    kind: "conflict",
    emailMatchId: a!.id,
    whatsappMatchId: b!.id,
  };
}
