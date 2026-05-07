// Canonical organization_type values stored on prelaunch_leads. Mirrors
// the comment in lib/db/src/schema/leads.ts. Kept as a module-level union
// so the classifier and any consuming code (analytics donut chart, manual
// "create professional" form in Phase D) reference the same allow-list.
export const ORG_TYPE_VALUES = [
  "law_firm",
  "immigration_consultancy",
  "global_mobility",
  "independent_practitioner",
] as const;

export type OrgType = (typeof ORG_TYPE_VALUES)[number];

// Keyword → org_type rules. Order matters: the FIRST rule whose pattern
// hits the combined "name + type-hint" haystack wins. This is deliberately
// hierarchical so a name like "Smith Immigration Attorneys" classifies as
// `law_firm` (attorneys is the more specific business signal) rather than
// `immigration_consultancy`.
//
// We match on word boundaries to avoid silly false positives — e.g. the
// substring "law" inside "Lawson Mobility" must NOT classify as a law
// firm; the `\blaw\b` rule means it would have to be the literal word.
// Each rule must require an unambiguous *industry* signal — bare tokens
// like "law", "legal", "visa", "mobility" appear in too many unrelated
// brand names ("Visa Inc", "Lawson Mobility", "Legal & General Insurance")
// to be safely conclusive. We therefore demand a qualifying suffix or a
// well-known professional-body acronym before bucketing.
const RULES: Array<{ type: OrgType; patterns: RegExp[] }> = [
  {
    type: "law_firm",
    patterns: [
      /\battorneys?\b/i,
      /\blaw\s+(?:firm|offices?|group|practice|chambers|society)\b/i,
      /\blawyers?\b/i,
      /\badvocates?\b/i,
      /\bsolicitors?\b/i,
      /\blegal\s+(?:counsel|services|practice|advisors?|consultants?)\b/i,
      /\binc\.?\s+attorneys\b/i,
      /,\s*llp\b/i, // trailing ", LLP" suffix is a strong law-firm signal
    ],
  },
  {
    type: "immigration_consultancy",
    patterns: [
      /\bimmigration\b/i,
      /\bemigration\b/i,
      /\bvisa\s+(?:services|consultanc|advis|application|processing|solutions)/i,
      /\bmigration\s+(?:consultanc|advis|services|agents?)/i,
      /\b(?:icc?rc|oisc|miarn|maramap?)\b/i, // recognised consultant bodies
    ],
  },
  {
    type: "global_mobility",
    patterns: [
      /\brelocation\b/i,
      /\bglobal\s+mobility\b/i,
      /\b(?:employee|workforce|talent|corporate)\s+mobility\b/i,
      /\bmobility\s+(?:services|solutions|consultanc|advis)/i,
      /\bglobal\s+workforce\b/i,
      /\bexpat(?:riate)?\s+services\b/i,
      /\bdestination\s+services\b/i,
      /\bassignment\s+management\b/i,
    ],
  },
];

/**
 * Best-effort industry classifier for an imported professional lead.
 *
 *   - Inspects organization_name + any free-form type hint (`organization_type`
 *     when the operator mapped a column to it but didn't normalise the
 *     value). Returning null is the explicit "no confident classification"
 *     signal so the caller can decide what to do (default to
 *     independent_practitioner, leave NULL, etc.).
 *   - Word-boundary regex avoids substring false positives ("Lawson"
 *     containing "law" must NOT trigger law_firm).
 *   - First-match-wins ordering encodes a hierarchy: `attorneys` is a
 *     stronger signal than `immigration` when both occur.
 *
 * Returns the matched OrgType or null when no rule fires.
 */
export function classifyOrgType(input: {
  organizationName?: string | null;
  organizationTypeHint?: string | null;
}): OrgType | null {
  const haystack = [
    input.organizationName ?? "",
    input.organizationTypeHint ?? "",
  ]
    .filter((s) => s.length > 0)
    .join(" ")
    .trim();
  if (haystack.length === 0) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) return rule.type;
  }
  return null;
}

/**
 * Helper for the import path: resolve the FINAL organization_type for an
 * imported professional row given (a) what the operator's mapping produced
 * and (b) the auto-classifier's verdict. Returns both the resolved value
 * AND a boolean indicating whether auto-classification was applied so the
 * caller can stamp an `auto_classified:org_type` tag for transparency.
 *
 * Decision table:
 *   mapped is one of ORG_TYPE_VALUES        → use mapped, NOT auto
 *   mapped is some other free-form string   → run classifier on (name + mapped); if hit, override; else fall back
 *   mapped is empty / null                  → run classifier on name; if miss, default to independent_practitioner
 */
export function resolveOrgType(input: {
  organizationName?: string | null;
  mappedOrgType?: string | null;
}): { value: OrgType; autoClassified: boolean } {
  const mapped =
    typeof input.mappedOrgType === "string" && input.mappedOrgType.trim().length > 0
      ? input.mappedOrgType.trim()
      : null;

  // Operator-provided canonical value: respect it, no auto-tag.
  if (mapped && (ORG_TYPE_VALUES as readonly string[]).includes(mapped)) {
    return { value: mapped as OrgType, autoClassified: false };
  }

  const guess = classifyOrgType({
    organizationName: input.organizationName,
    organizationTypeHint: mapped,
  });
  if (guess) return { value: guess, autoClassified: true };

  // No match anywhere — sole-trader / unknown structure. The "independent
  // practitioner" bucket is the explicit catch-all category in the schema
  // comment, so the analytics donut still has somewhere to put the row.
  return { value: "independent_practitioner", autoClassified: true };
}
