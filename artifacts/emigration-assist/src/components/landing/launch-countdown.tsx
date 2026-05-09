import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LAUNCH_ISO = "2026-06-01T00:00:00+02:00";
const LAUNCH_END_ISO = "2026-06-01T01:00:00+02:00";
const LAUNCH_DATE = new Date(LAUNCH_ISO);
const EVENT_TITLE = "E-Migration Assist Public Launch";
const EVENT_DESCRIPTION =
  "Public launch of the E-Migration Assist immigration technology platform. Visit the platform to register, claim your early-access reference, and explore the full ecosystem.";
const EVENT_URL =
  typeof window !== "undefined" ? window.location.origin : "https://emigrationassist.co.za";

type Parts = { days: number; hours: number; minutes: number; seconds: number; done: boolean };

function diffToParts(target: Date, now: Date): Parts {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const seconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
    done: false,
  };
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

// ICS uses UTC stamps in YYYYMMDDTHHMMSSZ
function toIcsUtc(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

// RFC 5545 §3.1 line folding: lines longer than 75 octets must be broken with
// CRLF + a single leading space on continuation lines. We measure in UTF-8
// bytes (octets), not chars, and never split inside a multi-byte sequence.
function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const dec = new TextDecoder("utf-8");
  const out: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Walk back if we'd split a UTF-8 continuation byte (10xxxxxx).
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    out.push(dec.decode(bytes.subarray(offset, end)));
    offset = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return out.join("\r\n ");
}

function buildIcs(): string {
  const dtStart = toIcsUtc(LAUNCH_DATE);
  const dtEnd = toIcsUtc(new Date(LAUNCH_END_ISO));
  const dtStamp = toIcsUtc(new Date());
  // Escape per RFC 5545: backslash, comma, semicolon, newlines.
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  // URI values: strip control chars and CR/LF; otherwise keep verbatim.
  const safeUri = (s: string) => s.replace(/[\r\n\u0000-\u001f\u007f]/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//E-Migration Assist//Launch//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:emigration-assist-launch-2026-06-01@emigrationassist`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(EVENT_TITLE)}`,
    `DESCRIPTION:${esc(EVENT_DESCRIPTION)}`,
    `URL:${safeUri(EVENT_URL)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc("E-Migration Assist launches today")}`,
    "TRIGGER:-PT24H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(foldIcsLine);
  return lines.join("\r\n");
}

function downloadIcs() {
  const blob = new Blob([buildIcs()], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "emigration-assist-launch.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function googleCalendarUrl() {
  const start = toIcsUtc(LAUNCH_DATE);
  const end = toIcsUtc(new Date(LAUNCH_END_ISO));
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: EVENT_TITLE,
    dates: `${start}/${end}`,
    details: EVENT_DESCRIPTION,
    ctz: "Africa/Johannesburg",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function outlookWebUrl() {
  // Outlook deeplink uses ISO strings
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: LAUNCH_ISO,
    enddt: LAUNCH_END_ISO,
    subject: EVENT_TITLE,
    body: EVENT_DESCRIPTION,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="relative rounded-xl sm:rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md px-2 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5 text-center shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
      data-testid={`countdown-${label.toLowerCase()}`}
      aria-hidden="true"
    >
      <div className="text-2xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-foreground tabular-nums">
        {pad(value)}
      </div>
      <div className="mt-0.5 sm:mt-1 text-[9px] sm:text-[10px] lg:text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function LaunchCountdown() {
  const [now, setNow] = useState(() => new Date());
  const [savedHint, setSavedHint] = useState(false);

  const parts = useMemo(() => diffToParts(LAUNCH_DATE, now), [now]);

  useEffect(() => {
    // Stop ticking once launch passes — keeps the "We're live" state stable
    // and avoids unnecessary re-renders forever.
    if (parts.done) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [parts.done]);

  const formattedDate = useMemo(
    () =>
      LAUNCH_DATE.toLocaleDateString("en-ZA", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Johannesburg",
      }),
    [],
  );

  const handleIcs = () => {
    downloadIcs();
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 2500);
  };

  return (
    <div
      className="relative w-full rounded-2xl sm:rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4 sm:p-5 lg:p-6 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]"
      data-testid="launch-countdown"
    >
      {/* glow accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 -right-12 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl"
      />

      <div className="relative flex flex-col items-center gap-5">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/80">
            Public launch countdown
          </p>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">
            <span className="text-foreground font-medium">{formattedDate}</span>
            <span className="text-muted-foreground"> · 00:00 SAST</span>
          </p>
        </div>

        {parts.done ? (
          <div className="text-center py-4">
            <p className="text-2xl font-semibold text-primary">We're live.</p>
            <p className="text-sm text-muted-foreground mt-1">
              The full E-Migration Assist platform is now available.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2 lg:gap-3 w-full">
              <Tile value={parts.days} label="Days" />
              <Tile value={parts.hours} label="Hours" />
              <Tile value={parts.minutes} label="Minutes" />
              <Tile value={parts.seconds} label="Seconds" />
            </div>
            {/* Single consolidated SR-only live region. Updates every minute
                via key (so seconds churn doesn't spam announcements) using a
                friendly natural-language sentence. */}
            <p
              className="sr-only"
              aria-live="polite"
              key={`${parts.days}-${parts.hours}-${parts.minutes}`}
            >
              {parts.days} days, {parts.hours} hours, and {parts.minutes}{" "}
              minutes until E-Migration Assist launches.
            </p>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-white/15 bg-white/5 hover:bg-white/10 backdrop-blur-md gap-2"
              data-testid="button-save-the-date"
            >
              {savedHint ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  Saved — check your downloads
                </>
              ) : (
                <>
                  <CalendarPlus className="h-4 w-4" />
                  Save the date
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56">
            <DropdownMenuItem onClick={handleIcs} data-testid="menuitem-cal-apple">
              Apple Calendar (.ics)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleIcs} data-testid="menuitem-cal-outlook-desktop">
              Outlook (desktop, .ics)
            </DropdownMenuItem>
            <DropdownMenuItem asChild data-testid="menuitem-cal-google">
              <a href={googleCalendarUrl()} target="_blank" rel="noreferrer noopener">
                Google Calendar
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild data-testid="menuitem-cal-outlook-web">
              <a href={outlookWebUrl()} target="_blank" rel="noreferrer noopener">
                Outlook.com (web)
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
