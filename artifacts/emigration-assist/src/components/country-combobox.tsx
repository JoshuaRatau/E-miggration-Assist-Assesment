import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COUNTRIES, findByIso, flagEmoji } from "@/lib/countries";

type Mode = "country" | "dial";

type CountryComboboxProps = {
  value?: string;
  onChange: (iso2: string) => void;
  placeholder?: string;
  mode?: Mode;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  testId?: string;
  ariaInvalid?: boolean;
};

export function CountryCombobox({
  value,
  onChange,
  placeholder = "Select a country",
  mode = "country",
  disabled,
  className,
  triggerClassName,
  testId,
  ariaInvalid,
}: CountryComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => findByIso(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid || undefined}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                <span aria-hidden className="text-base leading-none">
                  {flagEmoji(selected.iso2)}
                </span>
                <span className="truncate">
                  {mode === "dial"
                    ? `${selected.name} (${selected.dial})`
                    : `${selected.name} (${selected.iso2})`}
                </span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[--radix-popover-trigger-width] p-0", className)}
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            // itemValue is "name|iso|dial" — match any.
            if (!search) return 1;
            const q = search.toLowerCase();
            return itemValue.toLowerCase().includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search country…" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => {
                const itemValue = `${c.name}|${c.iso2}|${c.dial}`;
                return (
                  <CommandItem
                    key={c.iso2}
                    value={itemValue}
                    onSelect={() => {
                      onChange(c.iso2);
                      setOpen(false);
                    }}
                  >
                    <span aria-hidden className="mr-2 text-base leading-none">
                      {flagEmoji(c.iso2)}
                    </span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                      {mode === "dial" ? c.dial : c.iso2}
                    </span>
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4",
                        value === c.iso2 ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
