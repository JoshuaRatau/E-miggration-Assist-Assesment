import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  derivePreferredCommunication,
  type LeadForPreferredCommunication,
} from "@/lib/preferredCommunication";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

// Tiny presentation component for the "Preferred Communication" column
// in the leads table. Renders the channel icon + short label inside a
// pill that picks up a channel-specific accent so an operator scanning
// the table can immediately see which leads they'll reach over WA vs
// email vs in-app.
//
// Phase 5 §8 — on hover the pill now reveals the actual contact detail
// (email address / WhatsApp number) inside a white-background hover
// card with copy-to-clipboard + reveal/mask toggle. We use HoverCard
// (not Tooltip) so the panel is INTERACTIVE — moving the cursor from
// the pill into the card to click the buttons keeps it open. Numbers
// and emails are masked by default so over-the-shoulder previews don't
// leak PII; the operator can toggle the reveal explicitly.
const CLASS_BY_CHANNEL: Record<string, string> = {
  whatsapp:
    "border-emerald-300/40 bg-emerald-500/10 text-emerald-300",
  email: "border-sky-300/40 bg-sky-500/10 text-sky-300",
  in_app: "border-slate-300/40 bg-slate-500/10 text-slate-300",
};

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!domain || !local) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function maskPhone(value: string): string {
  const cleaned = value.replace(/\s+/g, "");
  if (cleaned.length <= 4) return "•••";
  const tail = cleaned.slice(-3);
  const head = cleaned.slice(0, Math.min(3, cleaned.length - 3));
  return `${head}${"•".repeat(cleaned.length - head.length - tail.length)}${tail}`;
}

export function PreferredCommunicationCell({
  lead,
}: {
  lead: LeadForPreferredCommunication;
}) {
  const pref = derivePreferredCommunication(lead);
  const cls = CLASS_BY_CHANNEL[pref.channel] ?? CLASS_BY_CHANNEL["in_app"]!;

  const contactValue =
    pref.channel === "whatsapp"
      ? lead.whatsapp ?? ""
      : pref.channel === "email"
        ? lead.email ?? ""
        : "";

  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const display = !contactValue
    ? "—"
    : revealed
      ? contactValue
      : pref.channel === "whatsapp"
        ? maskPhone(contactValue)
        : maskEmail(contactValue);

  const onCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!contactValue) return;
    try {
      await navigator.clipboard.writeText(contactValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — silent */
    }
  };

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${pref.label} — show contact detail`}
          className={
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium cursor-default bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 " +
            cls
          }
          data-channel={pref.channel}
          data-testid="cell-preferred-communication"
        >
          <span aria-hidden="true">{pref.icon}</span>
          <span>{pref.label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        sideOffset={6}
        className="bg-white text-slate-900 border border-slate-200 shadow-lg rounded-md p-3 w-auto max-w-xs"
      >
        <div className="text-xs leading-snug" data-testid="comm-tooltip-detail">
          <div className="font-semibold mb-0.5">{pref.label}</div>
          <div className="text-[11px] text-slate-500 mb-1.5">{pref.reason}</div>
          {contactValue ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px]">{display}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRevealed((v) => !v);
                }}
                className="text-[10px] uppercase tracking-wide text-sky-700 hover:text-sky-900"
                data-testid="comm-tooltip-reveal"
              >
                {revealed ? "Hide" : "Reveal"}
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="text-slate-500 hover:text-slate-900"
                aria-label="Copy contact detail"
                data-testid="comm-tooltip-copy"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          ) : (
            <div className="text-[11px] italic text-slate-500">
              No direct contact on file.
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
