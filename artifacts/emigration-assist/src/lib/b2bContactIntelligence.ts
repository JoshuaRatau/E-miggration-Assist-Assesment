// B2B contact intelligence — Phase 6A.
//
// Pure-render derivation that fills in the gaps when an operator hovers
// the email pill of a professional (B2B) lead. The schema now carries
// optional `representativeRole` and `representativeRelationship` columns
// (populated by the import pipeline / manual edit). When those are NULL,
// we fall back to two heuristics so the tooltip ALWAYS renders useful
// copy:
//
//   1. Role fallback   — derived from `organizationType`.
//   2. Relationship    — derived from the email local-part. Generic
//      mailboxes (`info@`, `admin@`, `hr@`, …) classify as a "General
//      Operations Contact"; a local matching the rep name as a
//      "Personal Decision-Maker Contact"; everything else as a
//      "Departmental Contact".
//
// `emailType` is a separate, always-derived signal describing the mailbox
// itself (Personal / Departmental / Generic) — independent of the
// relationship classifier above so the tooltip can show both.

export type B2BContactIntel = {
  contactName: string | null;
  role: string | null;
  organization: string | null;
  relationship: string;
  emailType: "personal" | "departmental" | "generic";
  emailTypeLabel: string;
};

export type B2BLeadShape = {
  leadType?: string | null;
  email?: string | null;
  organizationName?: string | null;
  organizationType?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  representativeRole?: string | null;
  representativeRelationship?: string | null;
};

const ORG_TYPE_ROLE_FALLBACK: Record<string, string> = {
  law_firm: "Partner / Attorney",
  immigration_consultancy: "Immigration Consultant",
  global_mobility: "Global Mobility Lead",
  independent_practitioner: "Independent Practitioner",
};

// Generic / shared mailboxes. Treated as departmental contacts even when
// they sit on a custom domain. Lowercased on read.
const GENERIC_LOCAL_PARTS = new Set([
  "info",
  "hello",
  "contact",
  "contactus",
  "admin",
  "office",
  "support",
  "help",
  "enquiries",
  "inquiries",
  "sales",
  "hr",
  "humanresources",
  "accounts",
  "billing",
  "team",
  "general",
  "reception",
  "frontdesk",
  "noreply",
  "no-reply",
]);

// Free-mail domains. A B2B lead writing in from a free-mail address is
// almost always the decision-maker themselves (no shared inbox), so we
// treat the local-part as personal even if it doesn't match the stored
// rep name.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.za",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
]);

function nonEmpty(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s\-']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function classifyEmailType(
  email: string,
  representativeName: string | null,
): { emailType: B2BContactIntel["emailType"]; emailTypeLabel: string } {
  const at = email.indexOf("@");
  if (at <= 0) {
    return { emailType: "generic", emailTypeLabel: "Generic mailbox" };
  }
  const local = email.slice(0, at).toLowerCase().replace(/[._-]/g, "");
  const domain = email.slice(at + 1).toLowerCase();

  if (GENERIC_LOCAL_PARTS.has(local)) {
    return { emailType: "generic", emailTypeLabel: "Generic / shared mailbox" };
  }

  // Free-mail domain → almost always personal regardless of local-part.
  if (FREE_MAIL_DOMAINS.has(domain)) {
    return { emailType: "personal", emailTypeLabel: "Personal mailbox" };
  }

  if (representativeName) {
    const tokens = nameTokens(representativeName);
    const localCompact = local;
    const matches = tokens.some(
      (tok) =>
        localCompact.includes(tok) || (tok.length >= 4 && local.startsWith(tok[0]!)),
    );
    if (matches) {
      return {
        emailType: "personal",
        emailTypeLabel: "Personal mailbox (matches contact name)",
      };
    }
  }

  return { emailType: "departmental", emailTypeLabel: "Departmental mailbox" };
}

function deriveRelationship(
  emailType: B2BContactIntel["emailType"],
  storedRelationship: string | null,
): string {
  if (storedRelationship) return storedRelationship;
  switch (emailType) {
    case "personal":
      return "Primary Decision-Maker Contact";
    case "departmental":
      return "Departmental Contact";
    case "generic":
    default:
      return "General Operations Contact";
  }
}

function deriveRole(
  storedRole: string | null,
  organizationType: string | null,
): string | null {
  if (storedRole) return storedRole;
  if (!organizationType) return null;
  return ORG_TYPE_ROLE_FALLBACK[organizationType] ?? null;
}

export function deriveB2BContactIntel(
  lead: B2BLeadShape,
): B2BContactIntel | null {
  if (lead.leadType !== "professional") return null;

  const email = nonEmpty(lead.representativeEmail) ?? nonEmpty(lead.email);
  const repName = nonEmpty(lead.representativeName);
  const orgName = nonEmpty(lead.organizationName);
  const role = deriveRole(
    nonEmpty(lead.representativeRole),
    nonEmpty(lead.organizationType),
  );
  const { emailType, emailTypeLabel } = email
    ? classifyEmailType(email, repName)
    : { emailType: "generic" as const, emailTypeLabel: "No address on file" };
  const relationship = deriveRelationship(
    emailType,
    nonEmpty(lead.representativeRelationship),
  );

  return {
    contactName: repName,
    role,
    organization: orgName,
    relationship,
    emailType,
    emailTypeLabel,
  };
}
