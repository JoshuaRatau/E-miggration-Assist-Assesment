// Phase 2 — lead-source attribution.
//
// `source` is the channel a lead arrived through. The server-side
// allow-list lives in api-server/src/routes/leads.ts; this module
// mirrors it for the dashboard so a copy-paste keeps the two in sync.
// Anything off-list is rendered as "Other" rather than the raw value.

export type LeadSource =
  | "web_form"
  | "referral"
  | "linkedin"
  | "facebook"
  | "google"
  | "direct"
  | "csv_import"
  | "manual"
  | "api"
  | "other";

export const LEAD_SOURCES: LeadSource[] = [
  "web_form",
  "referral",
  "linkedin",
  "facebook",
  "google",
  "direct",
  "csv_import",
  "manual",
  "api",
  "other",
];

type Meta = { label: string; tone: string };

// Tone classes use the same dark-pill conventions as the score and
// preferred-channel badges so the table stays visually consistent.
const META: Record<LeadSource, Meta> = {
  web_form: {
    label: "Web form",
    tone: "border-sky-300/40 bg-sky-500/10 text-sky-300",
  },
  referral: {
    label: "Referral",
    tone: "border-violet-300/40 bg-violet-500/10 text-violet-300",
  },
  linkedin: {
    label: "LinkedIn",
    tone: "border-indigo-300/40 bg-indigo-500/10 text-indigo-300",
  },
  facebook: {
    label: "Facebook",
    tone: "border-blue-300/40 bg-blue-500/10 text-blue-300",
  },
  google: {
    label: "Google",
    tone: "border-rose-300/40 bg-rose-500/10 text-rose-300",
  },
  direct: {
    label: "Direct",
    tone: "border-slate-300/40 bg-slate-500/10 text-slate-300",
  },
  csv_import: {
    label: "Import",
    tone: "border-amber-300/40 bg-amber-500/10 text-amber-300",
  },
  manual: {
    label: "Manual",
    tone: "border-zinc-300/40 bg-zinc-500/10 text-zinc-300",
  },
  api: {
    label: "API",
    tone: "border-cyan-300/40 bg-cyan-500/10 text-cyan-300",
  },
  other: {
    label: "Other",
    tone: "border-stone-300/40 bg-stone-500/10 text-stone-300",
  },
};

export function normalizeLeadSource(v: string | null | undefined): LeadSource {
  if (typeof v !== "string") return "web_form";
  const t = v.trim().toLowerCase();
  return (META as Record<string, Meta>)[t] ? (t as LeadSource) : "other";
}

export function leadSourceMeta(v: string | null | undefined): Meta {
  return META[normalizeLeadSource(v)];
}
