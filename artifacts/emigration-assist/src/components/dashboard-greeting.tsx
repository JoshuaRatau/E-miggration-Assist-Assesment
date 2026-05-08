import { useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/adminAuth";

// SAST never observes daylight saving — Africa/Johannesburg is a stable
// UTC+02:00. We still pin the IANA zone (rather than hard-coding +02:00)
// so the formatter stays correct even if a future operator's machine has
// the wrong system clock or locale.
const SAST_ZONE = "Africa/Johannesburg";

const dateFmt = new Intl.DateTimeFormat("en-ZA", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: SAST_ZONE,
});

const dateFmtCompact = new Intl.DateTimeFormat("en-ZA", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: SAST_ZONE,
});

const timeFmt = new Intl.DateTimeFormat("en-ZA", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SAST_ZONE,
});

function greetingForHour(hourSast: number): string {
  if (hourSast >= 5 && hourSast < 12) return "Good morning";
  if (hourSast >= 12 && hourSast < 17) return "Good afternoon";
  if (hourSast >= 17 && hourSast < 22) return "Good evening";
  return "Working late";
}

function sastHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    hour12: false,
    timeZone: SAST_ZONE,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(hh, 10);
}

function firstNameOf(
  user: { displayName: string | null; email: string } | null,
): string {
  if (!user) return "there";
  if (user.displayName) {
    const trimmed = user.displayName.trim();
    if (trimmed.length > 0) return trimmed.split(/\s+/)[0]!;
  }
  const local = user.email.split("@")[0] ?? "";
  if (local.length === 0) return "there";
  return local.split(/[._-]/)[0]!.replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Shared minute-aligned clock hook. Re-renders once per wall-clock minute
 * (cheap setInterval, aligned to the next minute boundary on mount so
 * the UI flips within ~1s of the real change instead of drifting).
 */
function useMinuteClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

/**
 * Phase 5H — topbar personalised greeting.
 *
 * Replaces the "Dashboard" title pill that previously sat next to the
 * brand logo in `AdminLayout`. Renders only when an admin is signed in
 * (gated by `useAdminAuth().user`), so logged-out chrome (login,
 * forgot-password) doesn't surface a stale greeting.
 */
export function TopbarGreeting() {
  const { user } = useAdminAuth();
  const now = useMinuteClock();
  if (!user) return null;
  const greeting = greetingForHour(sastHour(now));
  const firstName = firstNameOf(user);
  return (
    <div
      className="min-w-0 hidden sm:block"
      data-testid="topbar-greeting"
    >
      <p className="text-sm sm:text-base font-semibold text-white leading-tight truncate">
        {greeting}, {firstName}
      </p>
    </div>
  );
}

/**
 * Phase 5H — topbar live date/time strip.
 *
 * Sits to the immediate left of the Admin dropdown. On <sm viewports
 * the date is hidden and only the HH:mm clock shows so the topbar stays
 * single-row. SAST suffix is dropped on mobile for the same reason.
 */
export function TopbarClock() {
  const now = useMinuteClock();
  return (
    <div
      className="hidden md:flex items-center gap-2 text-xs text-white/70 px-3"
      data-testid="topbar-clock"
    >
      <span className="font-medium text-white/85">
        {dateFmtCompact.format(now)}
      </span>
      <span className="opacity-50">·</span>
      <span className="tabular-nums">{timeFmt.format(now)}</span>
      <span className="opacity-60">SAST</span>
    </div>
  );
}

/**
 * Phase 5H — body heading block.
 *
 * Slimmed down: the personalised greeting + clock that previously
 * lived here have been promoted into the AdminLayout topbar (left of
 * the page area for the greeting, right-of-page for the clock). What
 * remains is just the dashboard title + supporting subtitle.
 *
 * Kept as its own component (rather than inlined into admin.tsx) so a
 * future "all admin pages get a personalised heading" change has one
 * obvious extension point.
 */
export function DashboardGreeting() {
  return (
    <div
      data-testid="dashboard-heading-block"
      className="min-w-0 space-y-3"
    >
      <h1
        className="text-3xl sm:text-4xl font-display font-bold leading-tight tracking-tight text-white"
        data-testid="dashboard-heading"
      >
        Lead Intelligence Dashboard
      </h1>
      <p className="text-white/70 text-base max-w-2xl">
        Monitor, analyse and manage individual and professional lead
        activity in real time.
      </p>
    </div>
  );
}

// Long-form date formatter retained for any future surface (e.g. report
// PDFs) that wants the verbose "Friday, 8 May 2026" rendering.
export { dateFmt as longDateFmt };
