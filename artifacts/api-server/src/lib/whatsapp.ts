// WhatsApp number normalisation.
//
// Goals:
//  - strip presentation noise (spaces, brackets, slashes, dots, hyphens)
//  - convert SA local numbers (0XXXXXXXXX, 10 digits) → +27XXXXXXXXX
//  - accept already-international numbers starting with `+`
//  - validate the canonical form against /^\+\d{10,15}$/
//  - return null for anything that doesn't conform — callers must store null
//    rather than the raw string, and must NEVER reject the whole submission
//    on a bad number.

const NOISE = /[\s()/.\-]/g;
const CANONICAL = /^\+\d{10,15}$/;

export function normalizeWhatsapp(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const stripped = input.replace(NOISE, "");
  if (stripped.length === 0) return null;

  let candidate: string;
  if (stripped.startsWith("+")) {
    candidate = stripped;
  } else if (/^0\d{9}$/.test(stripped)) {
    // South African local format: 0XXXXXXXXX → +27XXXXXXXXX
    candidate = "+27" + stripped.slice(1);
  } else {
    return null;
  }

  return CANONICAL.test(candidate) ? candidate : null;
}
