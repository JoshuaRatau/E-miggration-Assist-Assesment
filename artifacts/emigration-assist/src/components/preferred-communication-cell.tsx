import {
  derivePreferredCommunication,
  type LeadForPreferredCommunication,
} from "@/lib/preferredCommunication";

// Tiny presentation component for the "Preferred Communication" column
// in the leads table. Renders the channel icon + short label inside a
// pill that picks up a channel-specific accent so an operator scanning
// the table can immediately see which leads they'll reach over WA vs
// email vs in-app.
//
// Channel colour map kept inline (not in a Record) so future channels
// (sms / linkedin / teams) can be added without a separate type-narrow.
const CLASS_BY_CHANNEL: Record<string, string> = {
  whatsapp:
    "border-emerald-300/40 bg-emerald-500/10 text-emerald-300",
  email: "border-sky-300/40 bg-sky-500/10 text-sky-300",
  in_app: "border-slate-300/40 bg-slate-500/10 text-slate-300",
};

export function PreferredCommunicationCell({
  lead,
}: {
  lead: LeadForPreferredCommunication;
}) {
  const pref = derivePreferredCommunication(lead);
  const cls = CLASS_BY_CHANNEL[pref.channel] ?? CLASS_BY_CHANNEL["in_app"]!;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
        cls
      }
      title={pref.reason}
      data-channel={pref.channel}
      data-testid="cell-preferred-communication"
    >
      <span aria-hidden="true">{pref.icon}</span>
      <span>{pref.label}</span>
    </span>
  );
}
