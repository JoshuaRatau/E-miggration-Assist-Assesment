import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Column-header / inline help tooltip — Phase 5 §6.
//
// Renders the wrapped label plus a subtle help glyph; on hover/focus,
// surfaces a white-background, dark-text tooltip with the contextual
// description. Designed for dark-theme dashboards where the default
// dark Radix tooltip would visually disappear against the dark page.
//
// Usage:
//   <HelpTooltip label="Type of Enquiry" description="…">
// Or, when wrapping non-text content:
//   <HelpTooltip description="…"><MyHeader /></HelpTooltip>
export function HelpTooltip({
  label,
  description,
  children,
  side = "top",
  className,
}: {
  label?: string;
  description: string;
  children?: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `${label} — help` : "Help"}
          className={
            "inline-flex items-center gap-1 cursor-help select-none bg-transparent border-0 p-0 m-0 font-inherit text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded " +
            (className ?? "")
          }
        >
          {children ?? <span>{label}</span>}
          <HelpCircle
            aria-hidden="true"
            className="h-3 w-3 text-muted-foreground/70"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="max-w-xs bg-white text-slate-900 border border-slate-200 shadow-lg rounded-md px-3 py-2 text-xs leading-snug"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
