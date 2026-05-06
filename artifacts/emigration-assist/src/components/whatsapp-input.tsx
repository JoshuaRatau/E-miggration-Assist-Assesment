import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { CountryCombobox } from "@/components/country-combobox";
import { COUNTRIES, DEFAULT_DIAL_ISO, findByIso } from "@/lib/countries";

type WhatsAppInputProps = {
  /** Canonical E.164 (e.g. "+27821234567") or empty string. */
  value: string;
  /** Called with canonical E.164 (or empty string when local is empty). */
  onChange: (next: string) => void;
  ariaInvalid?: boolean;
};

function parseInitial(value: string): { iso2: string; local: string } {
  const v = (value || "").trim();
  if (!v.startsWith("+")) {
    return { iso2: DEFAULT_DIAL_ISO, local: v.replace(/\D/g, "") };
  }
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (v.startsWith(c.dial)) {
      return { iso2: c.iso2, local: v.slice(c.dial.length).replace(/\D/g, "") };
    }
  }
  return { iso2: DEFAULT_DIAL_ISO, local: v.replace(/\D/g, "") };
}

function buildE164(iso2: string, local: string): string {
  const country = findByIso(iso2);
  if (!country) return "";
  const digits = (local || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  return `${country.dial}${digits}`;
}

export function WhatsAppInput({
  value,
  onChange,
  ariaInvalid,
}: WhatsAppInputProps) {
  // State is component-owned; we never resync from `value` mid-typing
  // (that would fight the user as buildE164 strips leading zeros).
  const initial = useMemo(() => parseInitial(value), []); // mount only
  const [iso2, setIso2] = useState(initial.iso2);
  const [local, setLocal] = useState(initial.local);

  const country = findByIso(iso2);

  function emit(nextIso: string, nextLocal: string) {
    onChange(buildE164(nextIso, nextLocal));
  }

  return (
    <div className="flex gap-2" data-testid="whatsapp-input">
      <div className="w-[160px] sm:w-[200px] shrink-0">
        <CountryCombobox
          value={iso2}
          mode="dial"
          onChange={(nextIso) => {
            setIso2(nextIso);
            emit(nextIso, local);
          }}
          placeholder="Country"
          testId="whatsapp-country"
          ariaInvalid={ariaInvalid}
        />
      </div>
      <div className="flex-1 flex items-center gap-2">
        <span
          className="text-sm text-muted-foreground tabular-nums px-2 py-1 rounded border bg-muted/30 select-none"
          aria-hidden
        >
          {country?.dial ?? "+"}
        </span>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="821234567"
          value={local}
          aria-invalid={ariaInvalid || undefined}
          data-testid="input-whatsapp"
          onChange={(e) => {
            const next = e.target.value;
            setLocal(next);
            emit(iso2, next);
          }}
        />
      </div>
    </div>
  );
}
