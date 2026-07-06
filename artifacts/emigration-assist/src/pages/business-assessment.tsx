import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { BrandHeader } from "@/components/brand-header";
import { CountryCombobox } from "@/components/country-combobox";
import { findByIso, findByName } from "@/lib/countries";
import { readFunnelContext } from "@/lib/funnelContext";
import heroSuitcase from "@assets/overstay_hero_no_bg.png";
import {
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  HeartHandshake,
  Sparkles,
  Check,
  Copy,
  CalendarCheck,
  Home as HomeIcon,
  Lock,
  X,
} from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(
  /\/$/,
  "",
);

type HeadcountBand = "1-5" | "6-20" | "21-50" | "51+";
type PracticeArea =
  | "work_visas"
  | "permanent_residence"
  | "appeals"
  | "condonation"
  | "corporate_mobility"
  | "other";
type PainTag =
  | "backlog"
  | "documents"
  | "compliance"
  | "team"
  | "client-experience"
  | "ai-readiness";
type CasesBand = "<25" | "25-99" | "100-249" | "250+";
type DurationBand = "<1 month" | "1-3 months" | "3-6 months" | ">6 months";
type Channel = "email" | "whatsapp";

interface PainAnswers {
  backlog: string;
  documents: string;
  compliance: string;
  team: string;
  clientExperience: string;
}

interface FormState {
  // Step 1 — Firm profile
  firmName: string;
  countryHq: string;
  headcountBand: HeadcountBand | null;
  yearsOperating: string;
  // Step 2 — Coverage
  practiceAreas: PracticeArea[];
  multiJurisBeyondZa: boolean | null;
  jurisdictions: string[];
  // Step 3 — Decision-maker
  decisionMakerTech: boolean | null;
  roleOfDecisionMaker: string;
  // Step 4 — Pain
  painAnswers: PainAnswers;
  painTags: PainTag[];
  // Step 5 — Volume
  casesLast12mBand: CasesBand | null;
  pctCrossBorder: number;
  typicalDurationBand: DurationBand | null;
  // Step 6 — Contact
  fullName: string;
  email: string;
  whatsapp: string;
  preferredChannel: Channel;
  city: string;
  provinceState: string;
  countryOfResidence: string;
  consentAccepted: boolean;
}

const INITIAL: FormState = {
  firmName: "",
  countryHq: "",
  headcountBand: null,
  yearsOperating: "",
  practiceAreas: [],
  multiJurisBeyondZa: null,
  jurisdictions: [],
  decisionMakerTech: null,
  roleOfDecisionMaker: "",
  painAnswers: {
    backlog: "",
    documents: "",
    compliance: "",
    team: "",
    clientExperience: "",
  },
  painTags: [],
  casesLast12mBand: null,
  pctCrossBorder: 0,
  typicalDurationBand: null,
  fullName: "",
  email: "",
  whatsapp: "",
  preferredChannel: "email",
  city: "",
  provinceState: "",
  countryOfResidence: "",
  consentAccepted: false,
};

const HEADCOUNT_OPTIONS: { value: HeadcountBand; label: string }[] = [
  { value: "1-5", label: "1–5" },
  { value: "6-20", label: "6–20" },
  { value: "21-50", label: "21–50" },
  { value: "51+", label: "51+" },
];

const PRACTICE_AREA_OPTIONS: { value: PracticeArea; label: string }[] = [
  { value: "work_visas", label: "Work visas" },
  { value: "permanent_residence", label: "Permanent residence" },
  { value: "appeals", label: "Appeals" },
  { value: "condonation", label: "Condonation" },
  { value: "corporate_mobility", label: "Corporate mobility" },
  { value: "other", label: "Other" },
];

const PAIN_TAG_OPTIONS: { value: PainTag; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "documents", label: "Documents" },
  { value: "compliance", label: "Compliance" },
  { value: "team", label: "Team" },
  { value: "client-experience", label: "Client experience" },
  { value: "ai-readiness", label: "AI readiness" },
];

const CASES_OPTIONS: { value: CasesBand; label: string }[] = [
  { value: "<25", label: "Fewer than 25" },
  { value: "25-99", label: "25–99" },
  { value: "100-249", label: "100–249" },
  { value: "250+", label: "250+" },
];

const DURATION_OPTIONS: { value: DurationBand; label: string }[] = [
  { value: "<1 month", label: "Less than 1 month" },
  { value: "1-3 months", label: "1–3 months" },
  { value: "3-6 months", label: "3–6 months" },
  { value: ">6 months", label: "More than 6 months" },
];

const PAIN_QUESTIONS: {
  key: keyof PainAnswers;
  heading: string;
  question: string;
}[] = [
  {
    key: "backlog",
    heading: "Q1 — Backlog & bottlenecks",
    question:
      "Where in your current immigration workflow are matters most often stuck or delayed, and what causes the bottleneck?",
  },
  {
    key: "documents",
    heading: "Q2 — Document chaos",
    question:
      "How do you currently collect, track and share client documents across matters, and where does this break down?",
  },
  {
    key: "compliance",
    heading: "Q3 — Compliance fear",
    question:
      "What is the compliance or regulatory risk that worries you most when handling client matters today?",
  },
  {
    key: "team",
    heading: "Q4 — Team coordination",
    question:
      "How does your team coordinate on a single client matter — who does what, and where are hand-offs failing?",
  },
  {
    key: "clientExperience",
    heading: "Q5 — Client experience",
    question:
      "What do your clients complain about most often during an active matter, and what would they like changed?",
  },
];

const REASSURING_LINES = [
  "Your firm's information is treated confidentially.",
  "The more accurately you describe your operation, the better we can tailor the platform to it.",
  "These answers guide how E-Migration Assist is built for firms like yours.",
  "There are no wrong answers — this is a picture of where you are today.",
];

// Visible step count shown to the visitor (Firm profile → Contact inclusive).
const TOTAL_QUESTION_STEPS = 6;
const STEP_INTRO = 0;
const STEP_FIRM = 1;
const STEP_COVERAGE = 2;
const STEP_DECISION = 3;
const STEP_PAIN = 4;
const STEP_VOLUME = 5;
const STEP_CONTACT = 6;
const STEP_SUCCESS = 7;

export default function BusinessAssessment() {
  const [step, setStep] = useState(STEP_INTRO);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    leadId: string;
    referenceNumber: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [jurisdictionDraft, setJurisdictionDraft] = useState("");

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const updatePain = (k: keyof PainAnswers, v: string) =>
    setForm((f) => ({ ...f, painAnswers: { ...f.painAnswers, [k]: v } }));

  const togglePracticeArea = (a: PracticeArea) =>
    setForm((f) => ({
      ...f,
      practiceAreas: f.practiceAreas.includes(a)
        ? f.practiceAreas.filter((x) => x !== a)
        : [...f.practiceAreas, a],
    }));

  const togglePainTag = (t: PainTag) =>
    setForm((f) => ({
      ...f,
      painTags: f.painTags.includes(t)
        ? f.painTags.filter((x) => x !== t)
        : [...f.painTags, t],
    }));

  const addJurisdiction = (raw: string) => {
    const val = raw.trim();
    if (!val) return;
    setForm((f) =>
      f.jurisdictions.some((j) => j.toLowerCase() === val.toLowerCase())
        ? f
        : { ...f, jurisdictions: [...f.jurisdictions, val] },
    );
    setJurisdictionDraft("");
  };

  const removeJurisdiction = (val: string) =>
    setForm((f) => ({
      ...f,
      jurisdictions: f.jurisdictions.filter((j) => j !== val),
    }));

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(STEP_INTRO, s - 1));

  // Per-step validation gating.
  const stepValid = (s: number): boolean => {
    switch (s) {
      case STEP_FIRM:
        return (
          form.firmName.trim().length > 0 &&
          form.countryHq.trim().length > 0 &&
          form.headcountBand !== null &&
          form.yearsOperating.trim() !== "" &&
          Number.isFinite(Number(form.yearsOperating)) &&
          Number(form.yearsOperating) >= 0
        );
      case STEP_COVERAGE:
        return (
          form.practiceAreas.length > 0 &&
          form.multiJurisBeyondZa !== null &&
          (form.multiJurisBeyondZa === false ||
            form.jurisdictions.length > 0)
        );
      case STEP_DECISION:
        return (
          form.decisionMakerTech !== null &&
          (form.decisionMakerTech === true ||
            form.roleOfDecisionMaker.trim().length > 0)
        );
      case STEP_PAIN:
        return PAIN_QUESTIONS.every(
          (q) => form.painAnswers[q.key].trim().length > 0,
        );
      case STEP_VOLUME:
        return (
          form.casesLast12mBand !== null && form.typicalDurationBand !== null
        );
      case STEP_CONTACT:
        return (
          form.fullName.trim().length > 0 &&
          form.email.trim().length > 0 &&
          /.+@.+\..+/.test(form.email) &&
          form.consentAccepted
        );
      default:
        return true;
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${BASE}/api/business-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firmName: form.firmName.trim(),
          countryHq: form.countryHq.trim(),
          headcountBand: form.headcountBand,
          yearsOperating: Number(form.yearsOperating),
          practiceAreas: form.practiceAreas,
          multiJurisBeyondZa: form.multiJurisBeyondZa === true,
          jurisdictions:
            form.multiJurisBeyondZa === true ? form.jurisdictions : [],
          decisionMakerTech: form.decisionMakerTech === true,
          roleOfDecisionMaker:
            form.decisionMakerTech === false
              ? form.roleOfDecisionMaker.trim() || null
              : null,
          painAnswers: {
            backlog: form.painAnswers.backlog.trim(),
            documents: form.painAnswers.documents.trim(),
            compliance: form.painAnswers.compliance.trim(),
            team: form.painAnswers.team.trim(),
            clientExperience: form.painAnswers.clientExperience.trim(),
          },
          painTags: form.painTags,
          casesLast12mBand: form.casesLast12mBand,
          pctCrossBorder: form.pctCrossBorder,
          typicalDurationBand: form.typicalDurationBand,
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          whatsapp: form.whatsapp.trim() || null,
          preferredChannel: form.preferredChannel,
          city: form.city.trim() || null,
          provinceState: form.provinceState.trim() || null,
          countryOfResidence: form.countryOfResidence.trim() || null,
          consentAccepted: true,
          website: "",
          funnelContext: readFunnelContext(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 || j.error === "already_registered") {
          const ref = j.referenceNumber as string | undefined;
          setSubmitError(
            (j.message ??
              "This email or contact number is already registered with us.") +
              (ref ? ` Your reference is ${ref}.` : ""),
          );
          return;
        }
        throw new Error(j.error ?? `Submission failed (${res.status})`);
      }
      const data = (await res.json()) as {
        leadId: string;
        referenceNumber: string;
      };
      setResult({ leadId: data.leadId, referenceNumber: data.referenceNumber });
      setStep(STEP_SUCCESS);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const contactName = form.fullName.trim() || form.firmName.trim() || "there";
  const progressPct = (Math.min(step, TOTAL_QUESTION_STEPS) / TOTAL_QUESTION_STEPS) * 100;

  const isIntro = step === STEP_INTRO;
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-300 via-slate-400 to-slate-500 text-foreground">
      <BrandHeader variant="compact" homeHref="/" homeHardNav />

      {/* Ambient brand glow */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-radial from-primary/10 via-primary/[0.03] to-transparent blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[380px] w-[380px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
      </div>

      <main
        className={`mx-auto px-4 pt-2 pb-10 sm:px-6 sm:pt-4 sm:pb-14 ${
          isIntro ? "max-w-5xl" : "max-w-2xl"
        }`}
      >
        {step >= STEP_FIRM && step < STEP_SUCCESS && (
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span>
                Step {step} of {TOTAL_QUESTION_STEPS}
              </span>
              <span className="inline-flex items-center gap-1.5 text-primary/80">
                <Lock className="h-3 w-3" />
                Confidential
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-card border border-card-border">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            "--foreground": "215 30% 22%",
            "--card": "210 40% 99%",
            "--card-foreground": "215 30% 22%",
            "--card-border": "214 25% 84%",
            "--border": "214 25% 84%",
            "--background": "210 40% 98%",
            "--muted": "210 30% 93%",
            "--muted-foreground": "215 16% 42%",
            "--input": "214 25% 84%",
          } as any}
          className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 p-6 backdrop-blur-md shadow-[0_20px_50px_-20px_rgba(15,23,42,0.25)] ring-1 ring-slate-900/[0.04] sm:p-10"
        >
          {/* INTRO */}
          {step === STEP_INTRO && (
            <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
              {/* Left — narrative + CTA */}
              <div className="space-y-6 text-center lg:text-left">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
                  For Immigration Firms & Professionals
                </span>

                <h1 className="font-display text-[2.4rem] font-extrabold leading-[1.02] tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]">
                  Run your practice with{" "}
                  <span className="bg-gradient-to-r from-primary to-cyan-600 bg-clip-text text-transparent">
                    structure & technology
                  </span>
                  .
                </h1>

                <p className="text-base text-muted-foreground sm:text-lg">
                  A guided 6-step assessment that maps how your firm handles
                  immigration matters today — and surfaces where a purpose-built
                  platform could remove the bottlenecks holding your team back.
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { icon: ShieldCheck, label: "Confidential" },
                    { icon: HeartHandshake, label: "Practical" },
                    { icon: Sparkles, label: "Tailored" },
                  ].map(({ icon: Icon, label }) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2.5 text-sm"
                    >
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-foreground/90">{label}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col items-center gap-3 sm:flex-row lg:items-start">
                  <Button
                    onClick={next}
                    size="lg"
                    className="w-full rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2 sm:w-auto"
                  >
                    Begin firm assessment
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Preliminary discovery for firms — a human reviews every
                  submission. No obligation.
                </p>
              </div>

              {/* Right — transparent hero image floats on the card */}
              <div className="relative mx-auto w-full max-w-md lg:max-w-none">
                <div className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-gradient-radial from-primary/25 via-primary/[0.05] to-transparent blur-2xl" />
                <img
                  src={heroSuitcase}
                  alt="Immigration firm technology assessment"
                  className="mx-auto h-auto w-full max-w-[420px] select-none drop-shadow-[0_25px_60px_rgba(0,0,0,0.55)]"
                  draggable={false}
                />
                <p className="mt-5 text-center font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                  Structured Immigration.{" "}
                  <span className="bg-gradient-to-r from-primary to-cyan-600 bg-clip-text text-transparent">
                    Powered by Technology.
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* STEP 1 — Firm profile */}
          {step === STEP_FIRM && (
            <QuestionBlock
              greeting="Let's start with your firm."
              question="Tell us about your practice."
              reassurance={REASSURING_LINES[0]}
            >
              <div className="space-y-4">
                <div>
                  <Label htmlFor="firmName" className="text-foreground/90">
                    Firm / company name
                  </Label>
                  <Input
                    id="firmName"
                    autoFocus
                    value={form.firmName}
                    onChange={(e) => update("firmName", e.target.value)}
                    placeholder="e.g. Meridian Immigration Attorneys"
                    className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
                <div>
                  <Label className="text-foreground/90">
                    Head office country
                  </Label>
                  <div className="mt-1">
                    <CountryCombobox
                      value={findByName(form.countryHq)?.iso2}
                      onChange={(iso2) =>
                        update("countryHq", findByIso(iso2)?.name ?? "")
                      }
                      placeholder="Select your head office country"
                      triggerClassName="h-11 rounded-xl border-card-border bg-background/60"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-foreground/90">
                    How many people work at your firm?
                  </Label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {HEADCOUNT_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => update("headcountBand", o.value)}
                        className={`rounded-xl border p-3 text-sm transition-all hover-elevate active-elevate-2 ${
                          form.headcountBand === o.value
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-card-border bg-background/40 text-muted-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="yearsOperating" className="text-foreground/90">
                    Years operating
                  </Label>
                  <Input
                    id="yearsOperating"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={form.yearsOperating}
                    onChange={(e) => update("yearsOperating", e.target.value)}
                    placeholder="e.g. 8"
                    className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
              </div>
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={!stepValid(STEP_FIRM)}
              />
            </QuestionBlock>
          )}

          {/* STEP 2 — Coverage */}
          {step === STEP_COVERAGE && (
            <QuestionBlock
              greeting="Your coverage"
              question="Which immigration areas do you handle?"
              hint="Select all that apply."
              reassurance={REASSURING_LINES[1]}
            >
              <div className="space-y-2">
                {PRACTICE_AREA_OPTIONS.map((a) => {
                  const checked = form.practiceAreas.includes(a.value);
                  return (
                    <label
                      key={a.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-all hover-elevate ${
                        checked
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-card-border bg-background/40 text-muted-foreground"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => togglePracticeArea(a.value)}
                      />
                      <span className="text-foreground/90">{a.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className="space-y-2 pt-2">
                <Label className="text-foreground/90">
                  Do you operate in multiple jurisdictions beyond South Africa?
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: true, label: "Yes" },
                    { value: false, label: "No" },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => update("multiJurisBeyondZa", o.value)}
                      className={`rounded-xl border p-3 text-sm transition-all hover-elevate active-elevate-2 ${
                        form.multiJurisBeyondZa === o.value
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-card-border bg-background/40 text-muted-foreground"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.multiJurisBeyondZa === true && (
                <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <Label className="text-foreground/90">
                    Which jurisdictions?
                  </Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <CountryCombobox
                        value={undefined}
                        onChange={(iso2) => {
                          const name = findByIso(iso2)?.name;
                          if (name) addJurisdiction(name);
                        }}
                        placeholder="Add a country"
                        triggerClassName="h-11 rounded-xl border-card-border bg-background/60"
                      />
                    </div>
                    <Input
                      value={jurisdictionDraft}
                      onChange={(e) => setJurisdictionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addJurisdiction(jurisdictionDraft);
                        }
                      }}
                      placeholder="or type & press Enter"
                      className="h-11 flex-1 rounded-xl border-card-border bg-background/60"
                    />
                  </div>
                  {form.jurisdictions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {form.jurisdictions.map((j) => (
                        <Badge
                          key={j}
                          variant="secondary"
                          className="gap-1 rounded-full border-primary/40 bg-primary/15 text-primary"
                        >
                          {j}
                          <button
                            type="button"
                            onClick={() => removeJurisdiction(j)}
                            className="ml-0.5 rounded-full hover-elevate"
                            aria-label={`Remove ${j}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={!stepValid(STEP_COVERAGE)}
              />
            </QuestionBlock>
          )}

          {/* STEP 3 — Decision-maker */}
          {step === STEP_DECISION && (
            <QuestionBlock
              greeting="Decision-making"
              question="Are you the decision-maker for technology and/or systems purchases?"
              reassurance={REASSURING_LINES[3]}
            >
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: true, label: "Yes" },
                  { value: false, label: "No" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => update("decisionMakerTech", o.value)}
                    className={`rounded-xl border p-4 text-sm transition-all hover-elevate active-elevate-2 ${
                      form.decisionMakerTech === o.value
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-card-border bg-background/40 text-muted-foreground"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {form.decisionMakerTech === false && (
                <div className="mt-2 space-y-2">
                  <Label
                    htmlFor="roleOfDecisionMaker"
                    className="text-foreground/90"
                  >
                    Who is the decision-maker, and what is your role?
                  </Label>
                  <Input
                    id="roleOfDecisionMaker"
                    autoFocus
                    value={form.roleOfDecisionMaker}
                    onChange={(e) =>
                      update("roleOfDecisionMaker", e.target.value)
                    }
                    placeholder="e.g. Managing Partner decides; I lead operations"
                    className="h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
              )}
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={!stepValid(STEP_DECISION)}
              />
            </QuestionBlock>
          )}

          {/* STEP 4 — Pain questions */}
          {step === STEP_PAIN && (
            <QuestionBlock
              greeting="Where it hurts"
              question="Help us understand your day-to-day friction."
              hint="Short, honest answers are best. Suggested 50–400 characters per question."
              reassurance={REASSURING_LINES[2]}
            >
              <div className="space-y-6">
                {PAIN_QUESTIONS.map((q, i) => {
                  const val = form.painAnswers[q.key];
                  return (
                    <div key={q.key} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/80">
                        {q.heading}
                      </p>
                      <Label
                        htmlFor={`pain-${q.key}`}
                        className="block text-sm text-foreground/90"
                      >
                        {q.question}
                      </Label>
                      <Textarea
                        id={`pain-${q.key}`}
                        value={val}
                        onChange={(e) => updatePain(q.key, e.target.value)}
                        placeholder={q.question}
                        autoFocus={i === 0}
                        className="min-h-[96px] rounded-xl border-card-border bg-background/60 text-sm"
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Suggested 50–400 characters</span>
                        <span className="tabular-nums">
                          {val.trim().length} characters
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className="space-y-2 pt-2">
                  <Label className="text-foreground/90">
                    Which themes best describe your pains?
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {PAIN_TAG_OPTIONS.map((t) => {
                      const selected = form.painTags.includes(t.value);
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => togglePainTag(t.value)}
                          className={`rounded-full border px-3 py-1.5 text-sm transition-all hover-elevate active-elevate-2 ${
                            selected
                              ? "border-primary/60 bg-primary/15 text-primary"
                              : "border-card-border bg-background/40 text-muted-foreground"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={!stepValid(STEP_PAIN)}
              />
            </QuestionBlock>
          )}

          {/* STEP 5 — Volume */}
          {step === STEP_VOLUME && (
            <QuestionBlock
              greeting="Your volume"
              question="How much immigration work flows through your firm?"
              reassurance={REASSURING_LINES[1]}
            >
              <div className="space-y-6">
                <div>
                  <Label className="text-foreground/90">
                    Roughly how many matters in the last 12 months?
                  </Label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CASES_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => update("casesLast12mBand", o.value)}
                        className={`rounded-xl border p-3 text-sm transition-all hover-elevate active-elevate-2 ${
                          form.casesLast12mBand === o.value
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-card-border bg-background/40 text-muted-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-foreground/90">
                      Approximately what % of matters are cross-border?
                    </Label>
                    <span className="font-display text-lg font-semibold text-primary tabular-nums">
                      {form.pctCrossBorder}%
                    </span>
                  </div>
                  <Slider
                    value={[form.pctCrossBorder]}
                    onValueChange={(v) =>
                      update("pctCrossBorder", v[0] ?? 0)
                    }
                    min={0}
                    max={100}
                    step={1}
                    className="mt-4"
                  />
                </div>

                <div>
                  <Label className="text-foreground/90">
                    Typical duration of a matter?
                  </Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {DURATION_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => update("typicalDurationBand", o.value)}
                        className={`rounded-xl border p-3 text-sm transition-all hover-elevate active-elevate-2 ${
                          form.typicalDurationBand === o.value
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-card-border bg-background/40 text-muted-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={!stepValid(STEP_VOLUME)}
              />
            </QuestionBlock>
          )}

          {/* STEP 6 — Contact + consent */}
          {step === STEP_CONTACT && (
            <div className="space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
                Almost done
              </p>
              <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                How can we reach you?
              </h2>
              <p className="text-sm text-muted-foreground">
                Your contact details are kept confidential and used only to
                follow up on your firm assessment.
              </p>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="fullName" className="text-foreground/90">
                    Full name
                  </Label>
                  <Input
                    id="fullName"
                    value={form.fullName}
                    onChange={(e) => update("fullName", e.target.value)}
                    placeholder="e.g. Sarah Ndlovu"
                    className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
                <div>
                  <Label htmlFor="email" className="text-foreground/90">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@firm.com"
                    className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="city" className="text-foreground/90">
                      City (optional)
                    </Label>
                    <Input
                      id="city"
                      value={form.city}
                      onChange={(e) => update("city", e.target.value)}
                      placeholder="e.g. Johannesburg"
                      className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="provinceState"
                      className="text-foreground/90"
                    >
                      Province / state (optional)
                    </Label>
                    <Input
                      id="provinceState"
                      value={form.provinceState}
                      onChange={(e) => update("provinceState", e.target.value)}
                      placeholder="e.g. Gauteng"
                      className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-foreground/90">
                    Country of residence (optional)
                  </Label>
                  <div className="mt-1">
                    <CountryCombobox
                      value={findByName(form.countryOfResidence)?.iso2}
                      onChange={(iso2) =>
                        update(
                          "countryOfResidence",
                          findByIso(iso2)?.name ?? "",
                        )
                      }
                      placeholder="Where are you based?"
                      triggerClassName="h-11 rounded-xl border-card-border bg-background/60"
                    />
                  </div>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-card-border bg-background/40 p-4 text-sm text-foreground/90 hover-elevate">
                <Checkbox
                  checked={form.consentAccepted}
                  onCheckedChange={(v) => update("consentAccepted", Boolean(v))}
                  className="mt-0.5"
                />
                <span>
                  I confirm the information provided is accurate to the best of
                  my knowledge, and I consent to E-Migration Assist storing
                  these details to assess my firm's needs and contact me about
                  next steps.
                </span>
              </label>

              {submitError && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <Button
                  variant="ghost"
                  onClick={back}
                  className="text-muted-foreground hover-elevate"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={submit}
                  disabled={!stepValid(STEP_CONTACT) || submitting}
                  className="rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2"
                >
                  {submitting ? "Submitting…" : "Submit & Book Free Demo"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>

              {/* Honeypot */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
            </div>
          )}

          {/* SUCCESS */}
          {step === STEP_SUCCESS && result && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/40">
                  <Check className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                    Thank you, {contactName}.
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Your firm assessment has been securely captured.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-primary/80">
                  Your reference number
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="font-display text-xl font-semibold text-foreground">
                    {result.referenceNumber}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(result.referenceNumber)
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        })
                        .catch(() => {});
                    }}
                    className="text-primary hover-elevate"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1 h-3 w-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 h-3 w-3" /> Copy
                      </>
                    )}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Keep this reference. We may use it when inviting your firm to
                  onboard onto the E-Migration Assist platform.
                </p>
              </div>

              <p className="text-sm text-muted-foreground">
                Based on what you've shared, our team will review how E-Migration
                Assist can be tailored to your firm's workflow. You may soon be
                invited to a structured walkthrough of the platform.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  className="rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2"
                >
                  <a
                    href="https://calendly.com/emigration-assist/15min?month=2026-07"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CalendarCheck className="mr-2 h-4 w-4" /> Book a Free Demo
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-xl border-slate-200 bg-white/60 backdrop-blur-md hover-elevate"
                >
                  <Link href={`/status?ref=${result.referenceNumber}`}>
                    Check my status
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-xl border-slate-200 bg-white/60 backdrop-blur-md hover-elevate"
                >
                  <a href="/">
                    <HomeIcon className="mr-2 h-4 w-4" /> Back to home
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function NavRow({
  onBack,
  onNext,
  nextDisabled,
  hideNext,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  hideNext?: boolean;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      {onBack ? (
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-muted-foreground hover-elevate"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      ) : (
        <span />
      )}
      {!hideNext && onNext && (
        <Button
          onClick={onNext}
          disabled={nextDisabled}
          className="rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function QuestionBlock({
  greeting,
  subtitle,
  question,
  hint,
  reassurance,
  children,
}: {
  greeting?: string;
  subtitle?: string;
  question: string;
  hint?: string;
  reassurance?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5 duration-500 animate-in fade-in slide-in-from-bottom-2">
      {greeting && (
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
          {greeting}
        </p>
      )}
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {question}
      </h2>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {reassurance && (
        <p className="border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">
          {reassurance}
        </p>
      )}
    </div>
  );
}
