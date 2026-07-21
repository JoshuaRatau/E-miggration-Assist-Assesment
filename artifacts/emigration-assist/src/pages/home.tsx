import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useGetStatsSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclaimer } from "@/components/disclaimer";
import { BrandHeader } from "@/components/brand-header";
import { trackEvent } from "@/lib/analytics";
import heroFolders from "@assets/hero-folders_1778252732296_nobg.png";
import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  FileText,
  ClipboardCheck,
  Hash,
  Mail,
  Rocket,
  Layers,
  ScanLine,
  BrainCircuit,
  Gauge,
  Lock,
  Globe2,
  Check,
  Star,
  Plane,
  AlertTriangle,
  Building2,
  KeyRound,
  Clock,
} from "lucide-react";

// Animated counter — ramps from 0 to target over ~1.2s with ease-out cubic.
// Respects prefers-reduced-motion by snapping to the final value.
function useCountUp(target: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target <= 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 1200;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

function StatTile({ value, label }: { value: number; label: string }) {
  const display = useCountUp(value);
  return (
    <div className="flex flex-col items-center bg-white/5 hover:bg-white/10 transition-colors px-6 py-4 rounded-xl border border-white/10 min-w-[140px]">
      <span className="text-3xl font-bold text-cyan-300 tabular-nums">{display}</span>
      <span className="text-sm text-slate-200 mt-1 text-center">{label}</span>
    </div>
  );
}

// Lightweight scroll-reveal: adds the visible state once the element enters the viewport.
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, shown };
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      } ${className}`}
    >
      {children}
    </div>
  );
}

const HOW_IT_WORKS = [
  {
    icon: ClipboardCheck,
    title: "Complete the preliminary assessment",
    body: "A guided, structured questionnaire — built around real immigration scenarios.",
  },
  {
    icon: FileText,
    title: "Receive a structured preliminary outcome",
    body: "An immediate, system-generated summary of your situation and indicated next steps.",
  },
  {
    icon: Hash,
    title: "Get your unique reference number",
    body: "A secure, private identifier you can return to at any time to track your case.",
  },
  {
    icon: Mail,
    title: "Be invited into the full ecosystem",
    body: "When the platform launches publicly, you'll be among the first to gain early access.",
  },
  {
    icon: Rocket,
    title: "Register, subscribe, and manage your journey",
    body: "Profile setup, document organisation, status tracking, and AI-assisted workflows.",
  },
];

const PRODUCT_PILLARS = [
  {
    icon: Layers,
    title: "Structured immigration workflows",
    body: "A rules-engine-backed platform that maps your situation to the right pathway, checklists, and timelines.",
  },
  {
    icon: ScanLine,
    title: "Document intelligence & organisation",
    body: "Upload, classify, and verify supporting documents — with reminders, checklists, and progress visibility.",
  },
  {
    icon: BrainCircuit,
    title: "AI-assisted guidance",
    body: "Smart summaries, missing-information prompts, and explanations that turn complex rules into clear next steps.",
  },
  {
    icon: Gauge,
    title: "Operational visibility",
    body: "Status tracking, system notifications, and a clean digital record of every step in your immigration journey.",
  },
];

const FREE_PLAN_BENEFITS = [
  "Structured profile setup",
  "Immigration tracking",
  "Document organisation",
  "Guided next steps",
  "System notifications",
  "Platform onboarding",
];

// Phase 8 — funnel trust/conversion content. Explains, in plain language,
// what EMA actually does with a matter once someone starts an assessment.
// Content-only; no forms, questions, or logic attached.
const HOW_EMA_HELPS = [
  {
    icon: ScanLine,
    title: "Route diagnosis",
    body: "We read your situation and point you to the correct immigration route before you commit to a path.",
  },
  {
    icon: ClipboardCheck,
    title: "Structured immigration intake",
    body: "A guided, confidential questionnaire captures the right details in the right order — no guesswork.",
  },
  {
    icon: FileText,
    title: "Document readiness support",
    body: "We help you understand which supporting documents matter, so your matter is organised from the start.",
  },
  {
    icon: Rocket,
    title: "Case handoff preparation",
    body: "Your information is prepared into a clean, structured record ready for the next step in your journey.",
  },
  {
    icon: ShieldCheck,
    title: "Secure handling of personal information",
    body: "Your details are handled securely and in line with privacy requirements — never shared without consent.",
  },
];

const TRUST_POINTS = [
  {
    icon: Lock,
    title: "Confidential by design",
    body: "Your information is encrypted in transit and at rest. Never shared with government agencies without explicit consent.",
  },
  {
    icon: ShieldCheck,
    title: "Built for structured immigration management",
    body: "Designed around real immigration workflows — not a generic form builder.",
  },
  {
    icon: Globe2,
    title: "South Africa first, globally scalable",
    body: "Built for the South African immigration ecosystem, with an architecture designed to expand beyond.",
  },
];

type FunnelRoute = {
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  examples: string[];
  cta: string;
  href: string;
  external: boolean;
  featured: boolean;
  testid: string;
};

// The primary funnel entry points. Overstay keeps the existing absolute-URL
// link (deliberate production routing); the rest use in-app Wouter navigation.
// Every route opens an EXISTING intake with EXISTING route context — nothing
// about the questionnaires, destinations, or funnel_context passing changes.
// `featured` marks the two priority journeys from the product brief (overstay
// + stuck applications) so they stay the most visually prominent.
const FUNNEL_ROUTES: FunnelRoute[] = [
  {
    icon: AlertTriangle,
    title: "Overstayed / Declared Undesirable",
    body: "If you've overstayed or been declared undesirable, time matters — we help you understand your options and next legal step before you act.",
    examples: [
      "Overstayed a visa or permit",
      "Declared undesirable or facing a ban",
      "Appealing a declaration",
      "Upliftment application",
      "Regularisation guidance",
    ],
    cta: "Start",
    href: "https://immigrationassist.replit.app/overstay-assessment?route=overstay_undesirable",
    external: true,
    featured: true,
    testid: "route-overstay",
  },
  {
    icon: Clock,
    title: "Visa Anomalies / Stuck Applications",
    body: "An application stuck, delayed, or an outcome that doesn't match? We help you diagnose it and route your matter to the right path.",
    examples: [
      "Pending for months at Home Affairs",
      "Documents or outcome don't match",
      "Can't work, bank, travel, or move",
      "Rejected and unsure why",
      "Status mismatch or error",
    ],
    cta: "Start",
    href: "/assessment?route=traveller&theme=stuck_application",
    external: false,
    featured: true,
    testid: "route-stuck",
  },
  {
    icon: Plane,
    title: "Traveller",
    body: "Understand the correct immigration pathway before you apply — no guesswork.",
    examples: [
      "Visiting South Africa",
      "Extending a stay",
      "Returning to South Africa",
      "Understanding visa options",
      "A new individual visa matter",
    ],
    cta: "Start",
    href: "/assessment?route=traveller",
    external: false,
    featured: false,
    testid: "route-traveller",
  },
  {
    icon: Building2,
    title: "Firm / Professional",
    body: "Built for teams and partners managing immigration on behalf of others.",
    examples: [
      "Immigration practitioners",
      "Law firms",
      "HR departments",
      "Corporate mobility teams",
      "Professional partners",
    ],
    cta: "Start",
    href: "/business-assessment?route=firm_professional",
    external: false,
    featured: false,
    testid: "route-firm",
  },
  {
    icon: KeyRound,
    title: "Continue with reference",
    body: "Only for existing EMA matters — pick up where you left off using your reference number.",
    examples: [
      "Check your case progress",
      "Resume a saved assessment",
      "Look up an existing reference",
    ],
    cta: "Continue",
    href: "/status?route=continue_reference",
    external: false,
    featured: false,
    testid: "route-reference",
  },
];

// Priority journeys lead the section; the rest follow in a secondary row.
const PRIORITY_ROUTES = FUNNEL_ROUTES.filter((r) => r.featured);
const STANDARD_ROUTES = FUNNEL_ROUTES.filter((r) => !r.featured);

// Renders the correct link element for a route: an absolute <a> for external
// production routing, or a Wouter <Link> for in-app navigation.
function RouteCTA({
  href,
  external,
  className = "",
  testid,
  onClick,
  children,
}: {
  href: string;
  external?: boolean;
  className?: string;
  testid?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (external) {
    return (
      <a href={href} className={className} data-testid={testid} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} data-testid={testid} onClick={onClick}>
      {children}
    </Link>
  );
}

// Milestone 2 — Funnel Intelligence (Phase 9): fire a lightweight, no-op-safe
// funnel event when a visitor selects a route. Metadata is parsed from the
// route's EXISTING href (route/theme query params + destination path) — nothing
// about navigation, CTA destinations, or funnel_context passing changes.
function trackRouteSelected(route: FunnelRoute) {
  let routeParam: string | undefined;
  let themeParam: string | undefined;
  let destinationPath: string | undefined;
  try {
    const url = new URL(route.href, window.location.origin);
    routeParam = url.searchParams.get("route") ?? undefined;
    themeParam = url.searchParams.get("theme") ?? undefined;
    destinationPath = url.pathname;
  } catch {
    // Malformed href — still record the selection without derived metadata.
  }
  trackEvent("funnel_route_selected", {
    payload: {
      route: routeParam,
      theme: themeParam,
      ctaLabel: route.cta,
      destinationPath,
      timestamp: new Date().toISOString(),
    },
  });
}

// A single funnel route card: icon, title, short description, 3–5 example
// situations, and a CTA that opens the EXISTING intake. Priority routes get the
// featured treatment (ring + gradient + "Most urgent" badge) so the two brief
// priority journeys stay the most visually prominent.
function RouteCard({ route }: { route: FunnelRoute }) {
  const r = route;
  return (
    <Card
      className={`group relative flex h-full flex-col justify-between overflow-hidden transition-all hover:-translate-y-0.5 ${
        r.featured
          ? "border-primary/50 bg-gradient-to-br from-primary/12 to-card/60 ring-1 ring-primary/30"
          : "bg-card/60 border-border/50 hover:border-primary/40"
      }`}
    >
      {r.featured && (
        <span className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow">
          Most urgent
        </span>
      )}
      <CardHeader className="space-y-4">
        <div
          className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-cyan-400/10 ring-1 ring-primary/30 text-primary"
          aria-hidden="true"
        >
          <r.icon className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <CardTitle className="text-lg leading-snug">{r.title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          {r.body}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {r.examples.map((ex) => (
            <li key={ex} className="flex items-start gap-2">
              <Check
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                strokeWidth={2.2}
                aria-hidden="true"
              />
              <span>{ex}</span>
            </li>
          ))}
        </ul>
        <RouteCTA
          href={r.href}
          external={r.external}
          testid={r.testid}
          onClick={() => trackRouteSelected(r)}
          className="mt-auto block"
        >
          <Button
            variant={r.featured ? "default" : "outline"}
            className="w-full rounded-xl gap-2"
          >
            {r.cta}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </RouteCTA>
      </CardContent>
    </Card>
  );
}

export function Home() {
  useEffect(() => {
    document.title =
      "E-Migration Assist — South Africa's next-generation immigration platform";
  }, []);

  const { data: stats, isLoading } = useGetStatsSummary();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 sm:px-6 lg:px-12 py-6 lg:py-10">
      <div className="w-full max-w-6xl mx-auto space-y-16 sm:space-y-20 lg:space-y-24">
        <BrandHeader
          rightSlot={
            <div className="relative hidden md:block" aria-hidden="true">
              <div className="absolute inset-0 -z-10 bg-gradient-radial from-primary/25 via-primary/5 to-transparent blur-2xl" />
              <img
                src={heroFolders}
                alt=""
                className="h-16 lg:h-20 w-auto select-none pointer-events-none drop-shadow-[0_12px_30px_rgba(17,97,140,0.55)]"
                data-testid="brand-header-folders"
              />
            </div>
          }
        />

        {/* ============================================================ */}
        {/* HERO — launch positioning (centered, countdown removed)       */}
        {/* ============================================================ */}
        <section className="relative pt-4">
          {/* Ambient backdrop glow ties the whole section together. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-[420px] w-[820px] max-w-full rounded-full bg-gradient-radial from-primary/15 via-primary/[0.04] to-transparent blur-3xl"
          />
          {/* Headline + sub centered now that the right-column countdown
              has been retired. Keeps the hero balanced against the full
              page width. */}
          <div className="relative text-center max-w-3xl mx-auto space-y-5">
            <h1
              className="text-[2rem] leading-[1.1] sm:text-5xl lg:text-[3.2rem] xl:text-[3.5rem] font-display font-bold tracking-tight text-slate-50"
              data-testid="hero-headline"
            >
              Overstayed, declared undesirable, or{" "}
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                stuck at Home Affairs?
              </span>
            </h1>
            <p className="text-base sm:text-lg lg:text-xl text-slate-200 leading-relaxed">
              If your visa expired, your application is stuck or mismatched, or
              you can't travel, work, or bank because your matter is unresolved —
              E-Migration Assist helps you find the right route and resolve it
              properly.
            </p>
          </div>

          {/* Trust signals under the hero. The four-route selector below is the
              primary action now — no intermediate "find your route" gate. */}
          <div className="relative mt-8 sm:mt-10 flex flex-col items-center gap-4 sm:gap-5">
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Confidential
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Structured assessment
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Free reference number
              </span>
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* CHOOSE YOUR ROUTE — the primary funnel entry points           */}
        {/* ============================================================ */}
        <Reveal>
          <section id="routes" className="scroll-mt-24 space-y-8">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                Choose your route
              </p>
              <h2 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight text-slate-50">
                Pick the path that matches your situation.
              </h2>
              <p className="text-base sm:text-lg text-slate-200 leading-relaxed">
                Five clear routes — each opens a structured, confidential
                assessment and gives you a free reference number. Start with the
                two most urgent situations, or pick the path that fits you.
              </p>
            </div>
            {/* Priority journeys — the two urgent situations from the product
                brief lead the section as larger, featured cards. */}
            <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
              {PRIORITY_ROUTES.map((r, i) => (
                <Reveal key={r.title} delay={i * 70}>
                  <RouteCard route={r} />
                </Reveal>
              ))}
            </div>
            {/* Remaining routes. */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {STANDARD_ROUTES.map((r, i) => (
                <Reveal key={r.title} delay={i * 70}>
                  <RouteCard route={r} />
                </Reveal>
              ))}
            </div>
            {/* Privacy / trust note — reassures before the visitor commits. */}
            <p className="mx-auto flex max-w-2xl items-start justify-center gap-2 text-center text-sm text-slate-300">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
              <span>
                Your information is used to route your matter and prepare the
                correct intake path. EMA handles personal information securely
                and in line with privacy requirements.
              </span>
            </p>
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* HOW EMA HELPS — compact funnel value summary                  */}
        {/* ============================================================ */}
        <Reveal>
          <section className="space-y-8">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                How EMA helps
              </p>
              <h2 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight text-slate-50">
                What happens once you start.
              </h2>
              <p className="text-base sm:text-lg text-slate-200 leading-relaxed">
                From the moment you choose a route, EMA works to diagnose your
                matter, structure your intake, and prepare it properly — securely,
                every step of the way.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {HOW_EMA_HELPS.map((item, i) => (
                <Reveal key={item.title} delay={i * 70}>
                  <div className="h-full rounded-2xl border border-border/50 bg-card/60 p-5 space-y-3">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* WHAT IS E-MIGRATION ASSIST                                    */}
        {/* ============================================================ */}
        <Reveal>
          <section className="space-y-10">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                What is E-Migration Assist?
              </p>
              <h2 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight text-slate-50">
                A modern technology ecosystem for South African immigration.
              </h2>
              <p className="text-base sm:text-lg text-slate-200 leading-relaxed">
                Not just a form. E-Migration Assist combines a rules engine,
                document intelligence, and AI-assisted workflows to bring
                operational clarity to a process that has historically been
                fragmented, paper-heavy, and slow.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
              {PRODUCT_PILLARS.map((p, i) => (
                <Reveal key={p.title} delay={i * 80}>
                  <Card className="group relative bg-card/60 backdrop-blur-sm border-border/50 hover:border-primary/40 hover:-translate-y-0.5 transition-all h-full overflow-hidden">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                    <CardHeader className="space-y-4">
                      <div
                        className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-cyan-400/10 ring-1 ring-primary/30 text-primary shadow-[0_0_24px_-8px_rgba(56,189,248,0.55)]"
                        aria-hidden="true"
                      >
                        <p.icon className="h-5 w-5" strokeWidth={1.6} />
                      </div>
                      <CardTitle className="text-lg">{p.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-base leading-relaxed">
                        {p.body}
                      </CardDescription>
                    </CardContent>
                  </Card>
                </Reveal>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* HOW IT WORKS — 5 step flow                                    */}
        {/* ============================================================ */}
        <Reveal>
          <section className="space-y-10">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                How it works
              </p>
              <h2 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight text-slate-50">
                From early-access assessment to full platform onboarding.
              </h2>
              <p className="text-base text-slate-200">
                Five clear steps — the first three happen now, the last two
                unlock at launch.
              </p>
            </div>

            <div className="relative">
              {/* connector line on lg+ */}
              <div
                aria-hidden="true"
                className="hidden lg:block absolute top-8 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
              />
              <ol className="grid gap-6 lg:gap-4 lg:grid-cols-5 relative">
                {HOW_IT_WORKS.map((step, idx) => (
                  <Reveal key={step.title} delay={idx * 90}>
                    <li className="relative flex lg:flex-col gap-4 lg:gap-3 lg:text-center lg:items-center">
                      <div className="relative flex-shrink-0">
                        <div className="h-16 w-16 rounded-2xl bg-card border border-border/60 flex items-center justify-center text-primary shadow-sm">
                          <step.icon className="h-6 w-6" />
                        </div>
                        <span className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shadow">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="flex-1 lg:flex-none space-y-1.5">
                        <h3 className="font-semibold text-slate-50 leading-tight">
                          {step.title}
                        </h3>
                        <p className="text-sm text-slate-200 leading-relaxed">
                          {step.body}
                        </p>
                      </div>
                    </li>
                  </Reveal>
                ))}
              </ol>
            </div>
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* FREE PLAN TEASER                                              */}
        {/* ============================================================ */}
        <Reveal>
          <section>
            <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
              />
              <div className="relative grid lg:grid-cols-[1.1fr_0.9fr] gap-8 p-6 sm:p-10 items-center">
                <div className="space-y-4">
                  <Badge
                    variant="outline"
                    className="border-primary/40 bg-primary/15 text-primary gap-1.5 rounded-full"
                  >
                    <Star className="h-3 w-3" />
                    Launching free for everyone
                  </Badge>
                  <h2 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-slate-50">
                    A free plan to help you start your immigration journey.
                  </h2>
                  <p className="text-base text-slate-200 leading-relaxed">
                    When the platform launches publicly, every user gets a free
                    starter tier — enough to organise your profile, track your
                    progress, and understand your next steps without paying a
                    cent.
                  </p>
                  <Link href="/assessment">
                    <Button
                      className="rounded-xl gap-2 mt-2"
                      data-testid="button-free-plan-cta"
                    >
                      Reserve your early access
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {FREE_PLAN_BENEFITS.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2.5 text-sm text-foreground/90 bg-card/80 border border-border/40 rounded-lg px-3 py-2.5"
                    >
                      <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* ORIGINAL THREE CARDS — kept, tightened                        */}
        {/* ============================================================ */}
        <Reveal>
          <section className="grid md:grid-cols-3 gap-5">
            <Card className="bg-card/60 border-border/50 hover:-translate-y-0.5 transition-transform">
              <CardHeader>
                <CardTitle className="text-lg">What this is</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  A structured, confidential questionnaire that records your
                  information and produces a preliminary, system-generated
                  assessment.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="bg-card/60 border-border/50 hover:-translate-y-0.5 transition-transform">
              <CardHeader>
                <CardTitle className="text-lg">Who it's for</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Anyone navigating visa expiry, overstay context, lost
                  documents, or other situations that require structured
                  review.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="bg-card/60 border-border/50 hover:-translate-y-0.5 transition-transform">
              <CardHeader>
                <CardTitle className="text-lg">What happens next</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  A secure reference number is issued to you. A notification
                  follows once more detailed assessment capabilities become
                  available.
                </CardDescription>
              </CardContent>
            </Card>
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* PRE-LAUNCH ACTIVITY — animated counters                       */}
        {/* ============================================================ */}
        <Reveal>
          <section className="text-center space-y-6">
            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                Live signal
              </p>
              <h3 className="text-2xl font-display font-semibold tracking-tight text-slate-50">
                Pre-launch activity
              </h3>
            </div>
            {isLoading ? (
              <div className="flex flex-wrap justify-center gap-4">
                <Skeleton className="h-24 w-36 rounded-xl" />
                <Skeleton className="h-24 w-36 rounded-xl" />
                <Skeleton className="h-24 w-36 rounded-xl" />
              </div>
            ) : stats ? (
              <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
                <StatTile value={stats.totalAssessments} label="Assessments recorded" />
                <StatTile value={stats.last24Hours} label="In the last 24 hours" />
                <StatTile
                  value={stats.byCategory?.length ?? 0}
                  label="Distinct review categories"
                />
              </div>
            ) : null}
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* TRUST                                                         */}
        {/* ============================================================ */}
        <Reveal>
          <section className="grid md:grid-cols-3 gap-5">
            {TRUST_POINTS.map((t) => (
              <div
                key={t.title}
                className="rounded-2xl border border-border/50 bg-card/60 p-5 space-y-3"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <t.icon className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-foreground">{t.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t.body}
                </p>
              </div>
            ))}
          </section>
        </Reveal>

        {/* ============================================================ */}
        {/* DISCLAIMER + FOOTER                                           */}
        {/* ============================================================ */}
        <div>
          <Disclaimer />
        </div>

        <footer className="text-center pt-4 pb-2 text-sm text-slate-300 space-y-3">
          <p>
            Strictly confidential. Information is not shared with government
            agencies without explicit consent.
          </p>
          <div>
            <Link
              href="/status"
              className="underline hover:text-primary transition-colors"
            >
              Already have a reference number? Check your status here.
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
