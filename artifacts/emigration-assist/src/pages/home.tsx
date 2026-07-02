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
    <div className="flex flex-col items-center bg-accent/40 hover:bg-accent/60 transition-colors px-6 py-4 rounded-xl border border-border/40 min-w-[140px]">
      <span className="text-3xl font-bold text-primary tabular-nums">{display}</span>
      <span className="text-sm text-muted-foreground mt-1 text-center">{label}</span>
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

export function Home() {
  useEffect(() => {
    document.title =
      "E-Migration Assist — South Africa's next-generation immigration platform";
  }, []);

  const { data: stats, isLoading } = useGetStatsSummary();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 sm:px-6 lg:px-12 py-6 lg:py-10">
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
              className="text-[2rem] leading-[1.1] sm:text-5xl lg:text-[3.2rem] xl:text-[3.5rem] font-display font-bold tracking-tight text-foreground"
              data-testid="hero-headline"
            >
              South Africa's next-generation{" "}
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                immigration platform
              </span>{" "}
              is arriving.
            </h1>
            <p className="text-base sm:text-lg lg:text-xl text-muted-foreground leading-relaxed">
              A new immigration technology ecosystem — structured workflows,
              document intelligence, and AI-assisted guidance for travellers,
              firms, and concierge clients.
            </p>
          </div>

          {/* CTAs + trust strip — the conversion focal point. */}
          <div className="relative mt-8 sm:mt-10 lg:mt-12 flex flex-col items-center gap-4 sm:gap-5">
            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 sm:gap-4 w-full sm:w-auto">
              <Link href="/assessment" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto h-14 px-7 text-base sm:text-lg rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 transition-all gap-2"
                  data-testid="button-start-assessment"
                >
                  Start as a Traveller
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <a
                href="https://immigrationassist.replit.app/overstay-assessment"
                className="w-full sm:w-auto"
              >
                <Button
                  size="lg"
                  className="w-full sm:w-auto h-14 px-7 text-base sm:text-lg rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 transition-all gap-2"
                  data-testid="button-start-overstayed"
                >
                  Start as Overstayed or Declared Undesirable
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </a>
              <Link href="/assessment" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto h-14 px-7 text-base sm:text-lg rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 transition-all gap-2"
                  data-testid="button-start-firm"
                >
                  Start as Firm/Professional
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            </div>
            <Link href="/status" className="w-full sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto h-14 px-6 text-base rounded-xl border-white/15 bg-white/5 hover:bg-white/10 backdrop-blur-md text-foreground/90 hover:text-foreground shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-all"
                data-testid="button-have-reference"
              >
                I already have a reference
              </Button>
            </Link>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
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
        {/* WHAT IS E-MIGRATION ASSIST                                    */}
        {/* ============================================================ */}
        <Reveal>
          <section className="space-y-10">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-primary/80">
                What is E-Migration Assist?
              </p>
              <h2 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight">
                A modern technology ecosystem for South African immigration.
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
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
              <p className="text-xs uppercase tracking-[0.22em] text-primary/80">
                How it works
              </p>
              <h2 className="text-3xl sm:text-4xl font-display font-semibold tracking-tight">
                From early-access assessment to full platform onboarding.
              </h2>
              <p className="text-base text-muted-foreground">
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
                        <h3 className="font-semibold text-foreground leading-tight">
                          {step.title}
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
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
                  <h2 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight">
                    A free plan to help you start your immigration journey.
                  </h2>
                  <p className="text-base text-muted-foreground leading-relaxed">
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
                      className="flex items-start gap-2.5 text-sm text-foreground/90 bg-card/50 border border-border/40 rounded-lg px-3 py-2.5"
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
              <p className="text-xs uppercase tracking-[0.22em] text-primary/80">
                Live signal
              </p>
              <h3 className="text-2xl font-display font-semibold tracking-tight">
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
                className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-3"
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

        <footer className="text-center pt-4 pb-2 text-sm text-muted-foreground space-y-3">
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
