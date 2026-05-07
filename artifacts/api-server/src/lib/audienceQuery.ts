import { z } from "zod";
import { sql, and, or, type SQL } from "drizzle-orm";
import { prelaunchLeadsTable } from "@workspace/db";

// Phase 4 — Campaign Engine: audience query builder + SQL compiler.
//
// The audience picker on the campaign editor is a rule-list with a single
// top-level combinator (AND / OR). Single-level was an explicit V1 simplification:
// every rule the operator could express via nested groups can also be expressed
// with `IN`/`NOT IN` operators. If real usage shows a need for nesting we'll
// extend `AudienceRule` to a discriminated union and compile recursively.
//
// Field allow-list is closed: only columns surfaced by the dashboard chips +
// known operator-friendly facets are selectable. This is both a security
// boundary (no SQL injection via user-controlled column names) and a
// product boundary (the editor can't drift from the dashboard's vocabulary).

export const AUDIENCE_FIELDS = [
  "leadType",
  "leadStatus",
  "leadPriority",
  "source",
  "inquiryType",
  "assignedTo",
  "createdAt",
  "lastContactedAt",
  "nextFollowUpAt",
  "tags",
  "hasEmail",
  "hasWhatsapp",
] as const;
export type AudienceField = (typeof AUDIENCE_FIELDS)[number];

// Operators are typed by field shape; the editor exposes only the relevant
// set per field. Server-side we re-validate with `assertOpForField` so a
// hand-crafted payload can't ask for `gte` on a boolean.
export const AUDIENCE_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gte",
  "lte",
  "is_null",
  "is_not_null",
  "contains",
] as const;
export type AudienceOp = (typeof AUDIENCE_OPS)[number];

export const AudienceRuleSchema = z.object({
  field: z.enum(AUDIENCE_FIELDS),
  op: z.enum(AUDIENCE_OPS),
  // Value polymorphism: string | number | boolean | string[] | iso-date string
  // | null. We keep the schema permissive here and tighten in `compile()` per
  // (field, op) pair so the error messages are actionable.
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.null(),
    ])
    .optional(),
});

export const AudienceQuerySchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  // Cap the rule count so a malicious payload can't expand the WHERE clause
  // unboundedly. 32 is well above any realistic operator-built audience.
  rules: z.array(AudienceRuleSchema).max(32),
});
export type AudienceRule = z.infer<typeof AudienceRuleSchema>;
export type AudienceQuery = z.infer<typeof AudienceQuerySchema>;

// ---------------------------------------------------------------------------
// (field, op) compatibility — assertion is server-side only; the UI also
// gates per-field operator menus to the same matrix.

const FIELD_KIND: Record<AudienceField, "string" | "ts" | "bool" | "tags" | "uuid"> = {
  leadType: "string",
  leadStatus: "string",
  leadPriority: "string",
  source: "string",
  inquiryType: "string",
  assignedTo: "uuid",
  createdAt: "ts",
  lastContactedAt: "ts",
  nextFollowUpAt: "ts",
  tags: "tags",
  hasEmail: "bool",
  hasWhatsapp: "bool",
};

const ALLOWED_OPS: Record<string, readonly AudienceOp[]> = {
  string: ["eq", "neq", "in", "not_in", "is_null", "is_not_null"],
  uuid: ["eq", "neq", "is_null", "is_not_null"],
  ts: ["gte", "lte", "is_null", "is_not_null"],
  bool: ["eq"],
  // Postgres array column. `contains` ⇒ ANY(tags) = value (single tag match).
  // Multi-tag intersection is composable via AND of multiple `contains` rules.
  tags: ["contains", "is_null", "is_not_null"],
};

function assertOpForField(field: AudienceField, op: AudienceOp): void {
  const kind = FIELD_KIND[field];
  if (!ALLOWED_OPS[kind].includes(op)) {
    throw new Error(`Operator '${op}' is not allowed for field '${field}'`);
  }
}

// ---------------------------------------------------------------------------
// SQL compiler.
//
// Returns a drizzle SQL fragment suitable for `.where()`. Empty rule list
// matches no rows (intentional — sending to "everyone" must be explicit, e.g.
// a single rule `{leadType, in, [individual, professional]}`). This is a
// deliberate guardrail: an empty filter is almost certainly an editor bug
// and we'd rather refuse to send than blast every lead in the system.

export class AudienceCompileError extends Error {}

function tsValue(value: unknown): Date {
  if (typeof value !== "string") {
    throw new AudienceCompileError("timestamp value must be an ISO string");
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AudienceCompileError(`invalid timestamp: ${value}`);
  }
  return d;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new AudienceCompileError("in/not_in value must be a string array");
  }
  if (value.length === 0) {
    throw new AudienceCompileError("in/not_in value must be non-empty");
  }
  if (value.length > 100) {
    throw new AudienceCompileError("in/not_in value capped at 100 entries");
  }
  return value as string[];
}

function compileRule(rule: AudienceRule): SQL {
  assertOpForField(rule.field, rule.op);
  const t = prelaunchLeadsTable;

  // Field → drizzle column. Listed explicitly (no string-indexing) so a
  // typo in `field` is a compile error rather than a runtime undefined.
  const col = (() => {
    switch (rule.field) {
      case "leadType":
        return t.leadType;
      case "leadStatus":
        return t.leadStatus;
      case "leadPriority":
        return t.leadPriority;
      case "source":
        return t.source;
      case "inquiryType":
        return t.inquiryType;
      case "assignedTo":
        return t.assignedTo;
      case "createdAt":
        return t.createdAt;
      case "lastContactedAt":
        return t.lastContactedAt;
      case "nextFollowUpAt":
        return t.nextFollowUpAt;
      case "tags":
        return t.tags;
      case "hasEmail":
        return t.email;
      case "hasWhatsapp":
        return t.whatsapp;
    }
  })();

  switch (rule.op) {
    case "eq": {
      // Boolean fields are virtual (synthesized from email/whatsapp NOT NULL).
      if (rule.field === "hasEmail" || rule.field === "hasWhatsapp") {
        return rule.value
          ? sql`${col} IS NOT NULL AND ${col} <> ''`
          : sql`(${col} IS NULL OR ${col} = '')`;
      }
      return sql`${col} = ${rule.value}`;
    }
    case "neq":
      return sql`${col} <> ${rule.value}`;
    case "in":
      return sql`${col} = ANY(${strArray(rule.value)})`;
    case "not_in":
      return sql`(${col} IS NULL OR NOT (${col} = ANY(${strArray(rule.value)})))`;
    case "gte":
      return sql`${col} >= ${tsValue(rule.value)}`;
    case "lte":
      return sql`${col} <= ${tsValue(rule.value)}`;
    case "is_null":
      return sql`${col} IS NULL`;
    case "is_not_null":
      return sql`${col} IS NOT NULL`;
    case "contains": {
      // Postgres array `ANY` membership. Cast to text[] in case the column
      // type info has been narrowed away by the SQL builder.
      if (typeof rule.value !== "string") {
        throw new AudienceCompileError("contains value must be a string");
      }
      return sql`${rule.value} = ANY(${col})`;
    }
  }
}

export function compileAudience(query: AudienceQuery): SQL | null {
  if (query.rules.length === 0) {
    // Refuse to compile — see top-of-file note. Caller should treat null as
    // "the audience is empty by intent" and either skip the query or 400.
    return null;
  }
  const fragments = query.rules.map(compileRule);
  if (fragments.length === 1) return fragments[0];
  const combined =
    query.combinator === "or" ? or(...fragments) : and(...fragments);
  // `and(...)` / `or(...)` only return undefined when called with no args,
  // which we've already guarded against above; the cast is safe.
  return combined as SQL;
}
