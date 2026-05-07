import type { PrelaunchLead } from "@workspace/db";

// Phase 4 — Campaign body / subject template renderer.
//
// Supports a tiny, fixed token vocabulary so the editor can show a real
// preview and the renderer can never accidentally execute arbitrary code:
//
//   {{first_name}}        → first whitespace-separated word of fullName,
//                           falling back to "there" when the name is blank.
//   {{full_name}}         → fullName verbatim, or "there" when blank.
//   {{reference}}         → referenceNumber (always present on a lead).
//   {{organization_name}} → for B2B leads; falls back to "your team".
//
// Unknown tokens are passed through UNCHANGED — the editor's live preview
// flags them visually so the operator sees the typo before sending.
//
// We intentionally don't ship Mustache or Handlebars: this is a stricter
// vocabulary, the audit trail is simpler (no conditionals / loops to reason
// about), and the security posture is trivial (no helper functions = no
// escape hatch for accidental data exposure).

export const TEMPLATE_TOKENS = [
  "first_name",
  "full_name",
  "reference",
  "organization_name",
] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export interface RenderContext {
  fullName: string | null;
  referenceNumber: string | null;
  organizationName: string | null;
}

export function leadToContext(lead: PrelaunchLead): RenderContext {
  return {
    fullName: lead.fullName,
    referenceNumber: lead.referenceNumber,
    organizationName: lead.organizationName,
  };
}

function resolveToken(name: string, ctx: RenderContext): string | undefined {
  switch (name) {
    case "first_name": {
      const fn = (ctx.fullName ?? "").trim().split(/\s+/)[0];
      return fn || "there";
    }
    case "full_name":
      return (ctx.fullName ?? "").trim() || "there";
    case "reference":
      return ctx.referenceNumber ?? "";
    case "organization_name":
      return (ctx.organizationName ?? "").trim() || "your team";
    default:
      return undefined;
  }
}

export function renderTemplate(input: string, ctx: RenderContext): string {
  if (!input) return "";
  return input.replace(TOKEN_RE, (match, name) => {
    const v = resolveToken(name, ctx);
    return v === undefined ? match : v;
  });
}

/**
 * Lint a template against a sample context — returns the list of unknown
 * tokens the editor should highlight. No mutation, no side effects.
 */
export function findUnknownTokens(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of input.matchAll(TOKEN_RE)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (!(TEMPLATE_TOKENS as readonly string[]).includes(name)) {
      out.push(name);
    }
  }
  return out;
}
