---
name: Scoped light-theme flip for assessment cards
description: How to lighten a whole assessment-card subtree on this globally-dark-themed app without editing every element.
---

The app's theme tokens are globally dark (`--background`/`--card`/`--foreground` are dark navy in `emigration-assist/src/index.css`, same values in `:root` and `.dark`). The firm (`business-assessment.tsx`) and overstay (`overstay-assessment.tsx`) pages use the same pattern: a **light outer gradient** (`bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500`) with a **dark navy card** (`bg-[#0a1628]/95`) holding all the form content.

**To make such a card light without touching dozens of descendants:** put a `style={{ ... } as any}` on the card container that redefines the theme CSS variables to light values (`--foreground`, `--card`, `--card-foreground`, `--card-border`, `--border`, `--background`, `--muted`, `--muted-foreground`, `--input`). Every descendant using `text-foreground`, `bg-background/*`, `border-card-border`, `text-muted-foreground` then flips automatically.

**Why:** the form has ~20+ token-driven elements; flipping tokens once is far lower-risk than editing each class.

**How to apply / gotchas:**
- Also fix the **hard-coded** colors that don't use tokens: card bg (`bg-[#0a1628]` → `bg-white/80`), any `border-white/*`/`bg-white/*` panels/pills/buttons, and darken gradient **text** (`from-primary to-cyan-400 bg-clip-text` → `to-cyan-600`) so it stays legible on white. Leave the progress-bar gradient (same classes minus `bg-clip-text`) bright.
- `React` is not in scope in these files (only `useState` imported) — cast the style object `as any`, not `as React.CSSProperties`.
- Token values are stored as `H S% L%` strings (e.g. `215 30% 22%`), consumed via `hsl(var(--x))`.
- The firm page (`business-assessment.tsx`) is currently the only lightened page. Home (`home.tsx`) and overstay (`overstay-assessment.tsx`) were lightened then REVERTED to the dark theme (user preferred original navy, Jul 2026) — don't re-apply without an explicit ask.
- Home page has no dark card — the whole page is light: the token overrides go on the root `min-h-screen` div (with the slate gradient bg) so every section's `bg-card`/`text-foreground`/`text-muted-foreground`/`bg-accent` element flips. Hard-coded fixes there: headline gradient text `to-cyan-400`→`to-cyan-600`, and the "I already have a reference" outline button's `border-white/*`/`bg-white/*`/dark shadow → light equivalents.
- Gotcha not yet fixed: BrandHeader logo is force-recoloured white (`brightness(0) invert(1)`), so it's faint on these light pages. Left as-is for consistency across firm/home; recolour would need a per-page prop on BrandHeader.
