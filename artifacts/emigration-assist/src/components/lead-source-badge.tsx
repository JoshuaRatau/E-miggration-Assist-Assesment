import { leadSourceMeta } from "@/lib/leadSource";

// Compact attribution chip for a lead row. Surfaces the channel as a
// coloured pill and (optionally) the campaign string immediately
// underneath in muted text so an operator scanning the table can see
// both without an extra hover.
export function LeadSourceBadge({
  source,
  campaign,
  className,
}: {
  source: string | null | undefined;
  campaign?: string | null;
  className?: string;
}) {
  const meta = leadSourceMeta(source);
  const trimmedCampaign =
    typeof campaign === "string" && campaign.trim().length > 0
      ? campaign.trim()
      : null;
  return (
    <span
      className={"inline-flex flex-col gap-0.5 " + (className ?? "")}
      data-testid="cell-lead-source"
      data-source={source ?? "web_form"}
    >
      <span
        className={
          "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
          meta.tone
        }
        title={
          trimmedCampaign
            ? `Source: ${meta.label} · Campaign: ${trimmedCampaign}`
            : `Source: ${meta.label}`
        }
      >
        {meta.label}
      </span>
      {trimmedCampaign ? (
        <span
          className="text-[10px] text-muted-foreground truncate max-w-[140px]"
          title={trimmedCampaign}
        >
          {trimmedCampaign}
        </span>
      ) : null}
    </span>
  );
}
