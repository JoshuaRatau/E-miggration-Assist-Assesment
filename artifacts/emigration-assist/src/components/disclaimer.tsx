import { Card, CardContent } from "@/components/ui/card";

interface DisclaimerProps {
  variant?: "default" | "compact";
  className?: string;
}

export function Disclaimer({ variant = "default", className = "" }: DisclaimerProps) {
  const text =
    "This tool provides a preliminary, system-generated assessment based on user input. It does not constitute legal advice, immigration advice, or any guarantee of outcome. Final determinations remain with the relevant authorities.";

  if (variant === "compact") {
    return (
      <p
        className={`text-xs text-muted-foreground leading-relaxed ${className}`}
        role="note"
        aria-label="Assessment disclaimer"
      >
        {text}
      </p>
    );
  }

  return (
    <Card
      className={`border-border/50 bg-muted/40 ${className}`}
      role="note"
      aria-label="Assessment disclaimer"
    >
      <CardContent className="py-4 px-5">
        <div className="flex gap-3 items-start">
          <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border border-muted-foreground/40 flex items-center justify-center text-muted-foreground text-xs font-semibold">
            i
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
        </div>
      </CardContent>
    </Card>
  );
}
