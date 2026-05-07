// Preferred-communication derivation — Phase 1 of the omnichannel
// communication architecture rollout.
//
// At this phase the channel is *derived* from the existing lead shape
// (no schema change yet); a future phase can add an explicit
// `preferred_channel` column on `prelaunch_leads` to let operators
// override the default.
//
// Default rules (per spec):
//   - B2B (lead_type = "professional") → ALWAYS Email. Professional
//     firms expect formal correspondence; even if a personal mobile
//     was captured we deliberately do not default them to WhatsApp.
//   - B2C (lead_type = "individual" / null) → WhatsApp if a number is
//     present, else Email if an address is present, else In-App as a
//     last-resort placeholder so the cell never renders blank.

export type PreferredChannel = "whatsapp" | "email" | "in_app";

export type PreferredCommunication = {
  channel: PreferredChannel;
  label: string;
  // Single-glyph icon — kept as a unicode/emoji string so the cell
  // doesn't need to load an icon-font / svg pack just for this.
  icon: string;
  // Short reason explaining how the default was chosen — surfaced as
  // a tooltip so an operator hovering can immediately understand why
  // (e.g. "B2B firm — formal email is the default channel").
  reason: string;
};

// Minimal subset of the lead shape we actually need to derive the
// channel. Kept structural so it stays compatible with both the slim
// dashboard list row (`AdminLeadListItem`) and the full `Lead`.
export type LeadForPreferredCommunication = {
  leadType?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  hasWhatsapp?: boolean;
};

function trimmedNonEmpty(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function derivePreferredCommunication(
  lead: LeadForPreferredCommunication,
): PreferredCommunication {
  const isProfessional = lead.leadType === "professional";
  const email = trimmedNonEmpty(lead.email);
  // Trust the server-derived `hasWhatsapp` flag when present; fall
  // back to a non-empty trim of the raw whatsapp string for older
  // payloads or imports.
  const whatsappPresent =
    typeof lead.hasWhatsapp === "boolean"
      ? lead.hasWhatsapp
      : trimmedNonEmpty(lead.whatsapp) !== null;

  if (isProfessional) {
    // B2B is unconditionally Email per spec — formal correspondence is
    // the expected channel for professional firms even if no address
    // is on file (the missing-email case is a data-quality issue
    // reflected in the reason string, not a fallback to a different
    // channel). Keeping this deterministic also means the filter and
    // the cell can never disagree for a professional row.
    return {
      channel: "email",
      label: "Email",
      icon: "📧",
      reason: email
        ? "B2B firm — formal email is the default channel."
        : "B2B firm — email is the default channel (no address on file yet).",
    };
  }

  // B2C below.
  if (whatsappPresent) {
    return {
      channel: "whatsapp",
      label: "WhatsApp",
      icon: "🟢",
      reason: "B2C lead with WhatsApp on file — fastest reach.",
    };
  }
  if (email) {
    return {
      channel: "email",
      label: "Email",
      icon: "📧",
      reason: "B2C lead — no WhatsApp on file, email is the default.",
    };
  }
  return {
    channel: "in_app",
    label: "In-App",
    icon: "🔔",
    reason: "No direct contact channel on file — in-app message only.",
  };
}
