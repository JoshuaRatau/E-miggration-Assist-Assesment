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
- The firm page was lightened this way; overstay still uses the dark card if the same request comes for it.
