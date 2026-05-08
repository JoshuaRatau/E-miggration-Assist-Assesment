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

const timeFmt = new Intl.DateTimeFormat("en-ZA", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: SAST_ZONE,
});

// Hour bucket → greeting copy. Boundaries chosen to feel natural for an
// internal SaaS dashboard:
//   05:00 – 11:59 → morning
//   12:00 – 16:59 → afternoon
//   17:00 – 21:59 → evening
//   22:00 – 04:59 → night (covers the after-hours operator)
function greetingForHour(hourSast: number): string {
  if (hourSast >= 5 && hourSast < 12) return "Good morning";
  if (hourSast >= 12 && hourSast < 17) return "Good afternoon";
  if (hourSast >= 17 && hourSast < 22) return "Good evening";
  return "Working late";
}

// Returns the current local hour as observed in SAST. We do this via the
// formatter (rather than `new Date().getHours()` which would use the
// browser's timezone) so the greeting matches the date/time strip below
// even when the operator is travelling.
function sastHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    hour12: false,
    timeZone: SAST_ZONE,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(hh, 10);
}

// Pull a presentable first name from the signed-in admin profile. Falls
// back to the local-part of the email if there's no displayName, and finally
// to "there" so the greeting always reads naturally.
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
  // "demo.admin" → "Demo", "alice_smith" → "Alice"
  const piece = local.split(/[._-]/)[0]!;
  return piece.charAt(0).toUpperCase() + piece.slice(1);
}

/**
 * Personalised greeting strip for the admin dashboard. Renders the
 * time-of-day greeting + signed-in operator's first name on the top line,
 * and a live-ticking "Wednesday, 7 May 2026 · 09:42 SAST" subline below.
 *
 * The clock re-renders once per minute (cheap setInterval) — minute-level
 * granularity is more than enough for an internal CRM and avoids the
 * battery hit of a 1Hz tick that nobody notices.
 */
export function DashboardGreeting() {
  const { user } = useAdminAuth();
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    // Align the first tick to the next wall-clock minute boundary so that
    // when "09:42" rolls to "09:43" the UI flips within ~1 second of the
    // real change instead of drifting up to 60s out of step.
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

  const greeting = greetingForHour(sastHour(now));
  const firstName = firstNameOf(user);
  return (
    <div data-testid="dashboard-greeting" className="min-w-0 space-y-6">
      <div className="space-y-2">
        <p className="text-lg font-semibold text-foreground/95 leading-tight">
          {greeting}, {firstName}
        </p>
        <p
          className="text-muted-foreground text-sm"
          data-testid="dashboard-clock"
        >
          <span className="font-medium text-foreground/75">
            {dateFmt.format(now)}
          </span>
          <span className="mx-2 opacity-50">·</span>
          <span className="tabular-nums">{timeFmt.format(now)}</span>
          <span className="ml-1 opacity-70">SAST</span>
        </p>
      </div>
      <div className="space-y-3">
        <h1
          className="text-3xl sm:text-4xl font-display font-bold leading-tight tracking-tight"
          data-testid="dashboard-heading"
        >
          Lead Intelligence Dashboard
        </h1>
        <p className="text-muted-foreground text-base max-w-2xl">
          Monitor, analyse and manage individual and professional lead
          activity in real time.
        </p>
      </div>
    </div>
  );
}
