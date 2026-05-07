import { z } from "zod";
import { LEAD_TYPE_VALUES, type LeadType } from "../classification";

// ── The set of prelaunch_leads columns an import may target ─────────────────
// Three buckets: common (any leadType), individual-only, professional-only.
// The mapping wizard only offers the bucket relevant to the chosen leadType.
export const COMMON_FIELDS = [
  "leadStatus",
  "leadPriority",
  "adminNotes",
  "tags",
] as const;

export const INDIVIDUAL_FIELDS = [
  "fullName",
  "email",
  "whatsapp",
  "nationality",
  "countryOfResidence",
  "currentlyInSouthAfrica",
  "passportStatus",
  "visaHistory",
  "immigrationSituation",
  "visaExpiryDate",
  "exitDate",
  "overstayReason",
  "preferredContactMethod",
] as const;

export const PROFESSIONAL_FIELDS = [
  "organizationName",
  "organizationType",
  "representativeName",
  "representativeEmail",
  "representativePhone",
  "website",
  "firmSize",
  "operatingRegions",
  "serviceFocus",
  "estimatedClientVolume",
] as const;

export type LeadField =
  | (typeof COMMON_FIELDS)[number]
  | (typeof INDIVIDUAL_FIELDS)[number]
  | (typeof PROFESSIONAL_FIELDS)[number];

export function fieldsForLeadType(t: LeadType): LeadField[] {
  return [
    ...COMMON_FIELDS,
    ...(t === "individual" ? INDIVIDUAL_FIELDS : PROFESSIONAL_FIELDS),
  ];
}

// Auto-suggest aliases. Keys are normalised (lowercased + alnum-only); the
// table is intentionally generous so the wizard's "Suggested mapping" gives
// the operator a sensible default for the most common spreadsheet headings.
const ALIASES: Record<string, LeadField> = {
  // common
  status: "leadStatus",
  leadstatus: "leadStatus",
  priority: "leadPriority",
  leadpriority: "leadPriority",
  notes: "adminNotes",
  comments: "adminNotes",
  note: "adminNotes",
  tags: "tags",
  labels: "tags",
  // individual
  name: "fullName",
  fullname: "fullName",
  contactname: "fullName",
  customername: "fullName",
  email: "email",
  emailaddress: "email",
  emailid: "email",
  phone: "whatsapp",
  phonenumber: "whatsapp",
  whatsapp: "whatsapp",
  whatsappnumber: "whatsapp",
  mobile: "whatsapp",
  cell: "whatsapp",
  cellphone: "whatsapp",
  nationality: "nationality",
  citizenship: "nationality",
  passportcountry: "nationality",
  countryofresidence: "countryOfResidence",
  residence: "countryOfResidence",
  country: "countryOfResidence",
  insouthafrica: "currentlyInSouthAfrica",
  insa: "currentlyInSouthAfrica",
  insidesa: "currentlyInSouthAfrica",
  passport: "passportStatus",
  passportstatus: "passportStatus",
  visa: "visaHistory",
  visahistory: "visaHistory",
  visatype: "visaHistory",
  situation: "immigrationSituation",
  immigrationsituation: "immigrationSituation",
  immigrationstatus: "immigrationSituation",
  visaexpiry: "visaExpiryDate",
  visaexpirydate: "visaExpiryDate",
  expirydate: "visaExpiryDate",
  exitdate: "exitDate",
  departuredate: "exitDate",
  overstay: "overstayReason",
  overstayreason: "overstayReason",
  reason: "overstayReason",
  preferredcontact: "preferredContactMethod",
  contactmethod: "preferredContactMethod",
  preferredcontactmethod: "preferredContactMethod",
  // professional
  organization: "organizationName",
  organisation: "organizationName",
  organizationname: "organizationName",
  organisationname: "organizationName",
  company: "organizationName",
  companyname: "organizationName",
  firm: "organizationName",
  firmname: "organizationName",
  organizationtype: "organizationType",
  organisationtype: "organizationType",
  companytype: "organizationType",
  representative: "representativeName",
  representativename: "representativeName",
  contactperson: "representativeName",
  representativeemail: "representativeEmail",
  contactemail: "representativeEmail",
  representativephone: "representativePhone",
  contactphone: "representativePhone",
  website: "website",
  url: "website",
  homepage: "website",
  firmsize: "firmSize",
  size: "firmSize",
  employees: "firmSize",
  regions: "operatingRegions",
  operatingregions: "operatingRegions",
  countries: "operatingRegions",
  servicefocus: "serviceFocus",
  focus: "serviceFocus",
  speciality: "serviceFocus",
  specialty: "serviceFocus",
  clientvolume: "estimatedClientVolume",
  estimatedclientvolume: "estimatedClientVolume",
  volume: "estimatedClientVolume",
  caseload: "estimatedClientVolume",
};

function normalizeColumnKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function suggestMapping(
  columns: string[],
  leadType: LeadType,
): Record<string, LeadField | null> {
  const allowed = new Set(fieldsForLeadType(leadType));
  const out: Record<string, LeadField | null> = {};
  // Track first-pick-wins so two columns can't both auto-suggest "email".
  const claimed = new Set<LeadField>();
  for (const col of columns) {
    const key = normalizeColumnKey(col);
    const guess = ALIASES[key];
    if (guess && allowed.has(guess) && !claimed.has(guess)) {
      out[col] = guess;
      claimed.add(guess);
    } else {
      out[col] = null;
    }
  }
  return out;
}

// ── Per-field zod schemas (applied only when the cell is non-empty) ─────────
const emailSchema = z.string().email();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const intSchema = z
  .string()
  .regex(/^-?\d+$/, "expected integer")
  .transform((s) => parseInt(s, 10));
const boolSchema = z
  .string()
  .transform((s) => s.toLowerCase().trim())
  .pipe(z.enum(["true", "false", "yes", "no", "y", "n", "1", "0"]))
  .transform((s) => s === "true" || s === "yes" || s === "y" || s === "1");

const FIELD_SCHEMAS: Partial<Record<LeadField, z.ZodTypeAny>> = {
  email: emailSchema,
  representativeEmail: emailSchema,
  visaExpiryDate: dateSchema,
  exitDate: dateSchema,
  estimatedClientVolume: intSchema,
  currentlyInSouthAfrica: boolSchema,
};

export interface RowValidationError {
  field: string;
  message: string;
}

export interface ParsedRow {
  fields: Record<string, unknown>;
  // Lenient-capture surface: unmapped columns are dropped onto the lead's
  // tags array as `csv:colname=value` strings so nothing is silently lost.
  unmappedTags: string[];
}

export function validateRow(args: {
  raw: Record<string, string>;
  mapping: Record<string, string | null>;
  leadType: LeadType;
}):
  | { ok: true; parsed: ParsedRow }
  | { ok: false; errors: RowValidationError[] } {
  const { raw, mapping, leadType } = args;
  const allowed = new Set<LeadField>(fieldsForLeadType(leadType));
  const fields: Record<string, unknown> = {};
  const errors: RowValidationError[] = [];
  const unmappedTags: string[] = [];

  for (const [col, rawVal] of Object.entries(raw)) {
    const target = mapping[col] ?? null;
    const trimmed = (rawVal ?? "").trim();
    if (!target) {
      // Lenient capture: only stash non-empty cells. Cap each tag so a
      // pathological essay-in-a-cell can't blow out the lead's tags column.
      if (trimmed.length > 0) {
        unmappedTags.push(`csv:${col}=${trimmed}`.slice(0, 80));
      }
      continue;
    }
    if (!allowed.has(target as LeadField)) {
      errors.push({
        field: col,
        message: `mapped to "${target}" which is not a valid field for leadType=${leadType}`,
      });
      continue;
    }
    if (trimmed.length === 0) continue; // empty cells are ignored

    if (target === "tags" || target === "operatingRegions") {
      // Comma-separated array fields. Empty pieces dropped.
      fields[target] = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    const schema = FIELD_SCHEMAS[target as LeadField];
    if (schema) {
      const parsed = schema.safeParse(trimmed);
      if (!parsed.success) {
        errors.push({
          field: col,
          message:
            parsed.error.issues[0]?.message ??
            `invalid value for ${target}`,
        });
        continue;
      }
      fields[target] = parsed.data;
    } else {
      fields[target] = trimmed;
    }
  }

  // Type-specific minimum-viable-row checks. Cheaper to enforce here than
  // to push it down into the prelaunch_leads NOT NULL constraints (where the
  // failure surfaces as a generic Postgres error the operator can't act on).
  if (leadType === "individual") {
    if (!fields["email"] && !fields["whatsapp"]) {
      errors.push({
        field: "(row)",
        message: "individual leads need at least one of email or whatsapp",
      });
    }
  } else if (leadType === "professional") {
    if (!fields["organizationName"]) {
      errors.push({
        field: "(row)",
        message: "professional leads need an organizationName",
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    parsed: { fields, unmappedTags: unmappedTags.slice(0, 10) },
  };
}

export const LEAD_TYPE_SCHEMA = z.enum(LEAD_TYPE_VALUES);
export const DEDUPE_STRATEGIES = [
  "skip",
  "update",
  "create_anyway",
] as const;
export const DEDUPE_SCHEMA = z.enum(DEDUPE_STRATEGIES);
export type DedupeStrategy = (typeof DEDUPE_STRATEGIES)[number];
