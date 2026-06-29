import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

/**
 * Top search bar. Phase 1: a working client-side filter over the already-
 * fetched leads (matches name / organisation / email / reference). The ⌘K
 * affordance is a placeholder for the full command palette in a later phase —
 * for now it focuses the input.
 */
export function CommandSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative" data-testid="dashboard-search-bar">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      >
        🔍
      </span>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search leads by name, organisation, email or reference…"
        className="h-11 rounded-xl pl-9 pr-16"
        data-testid="dashboard-search-input"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </div>
  );
}
