import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { BrandHeader } from "@/components/brand-header";
import { DocumentUploader } from "@/components/DocumentUploader";
import brandLogo from "@assets/E-Migration_Assist_New_Logo-removebg-preview_1778252859401.png";
import {
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  HeartHandshake,
  Sparkles,
  Check,
  Copy,
  Home as HomeIcon,
  Lock,
} from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(
  /\/$/,
  "",
);

type Situation =
  | "visa_expired"
  | "undesirable_declaration"
  | "overstayed_after_expiry"
  | "unsure_of_status"
  | "application_rejected_in_sa"
  | "missed_departure_deadline"
  | "other";

type Location = "inside_sa" | "outside_sa";
type Duration = "lt_30_days" | "30_to_90_days" | "gt_90_days" | "unsure";
type YesNoUnsure = "yes" | "no" | "unsure";
type Assistance =
  | "understand_legal_position"
  | "overstay_appeal"
  | "next_steps_guidance"
  | "professional_support"
  | "future_visa_planning"
  | "general_guidance";

type Challenge =
  | "next_steps_unclear"
  | "fear_of_ban"
  | "communication_difficulty"
  | "financial_constraints"
  | "delays_uncertainty"
  | "lack_of_guidance"
  | "stress_anxiety"
  | "travel_restrictions"
  | "other";

type Channel = "email" | "whatsapp";

interface FormState {
  firstName: string;
  currentSituation: Situation | null;
  otherSituationDetail: string;
  location: Location | null;
  overstayDuration: Duration | null;
  submittedApplication: YesNoUnsure | null;
  applicationType: string;
  dhaCommunication: YesNoUnsure | null;
  challenges: Challenge[];
  assistanceType: Assistance | null;
  email: string;
  phone: string;
  whatsappOptIn: boolean;
  preferredChannel: Channel;
  wantsToUploadDocs: boolean;
  consentAccepted: boolean;
}

const INITIAL: FormState = {
  firstName: "",
  currentSituation: null,
  otherSituationDetail: "",
  location: null,
  overstayDuration: null,
  submittedApplication: null,
  applicationType: "",
  dhaCommunication: null,
  challenges: [],
  assistanceType: null,
  email: "",
  phone: "",
  whatsappOptIn: false,
  preferredChannel: "email",
  wantsToUploadDocs: false,
  consentAccepted: false,
};

const SITUATION_OPTIONS: { value: Situation; label: string }[] = [
  { value: "visa_expired", label: "My visa has expired" },
  { value: "undesirable_declaration", label: "I received an undesirable declaration" },
  { value: "overstayed_after_expiry", label: "I overstayed after my visa expiry" },
  { value: "unsure_of_status", label: "I am unsure about my current legal status" },
  { value: "application_rejected_in_sa", label: "My application was rejected while I remained in South Africa" },
  { value: "missed_departure_deadline", label: "I missed my departure deadline" },
  { value: "other", label: "Other" },
];

const DURATION_OPTIONS: { value: Duration; label: string }[] = [
  { value: "lt_30_days", label: "Less than 30 days" },
  { value: "30_to_90_days", label: "30 to 90 days" },
  { value: "gt_90_days", label: "More than 90 days" },
  { value: "unsure", label: "Unsure" },
];

const ASSISTANCE_OPTIONS: { value: Assistance; label: string }[] = [
  { value: "understand_legal_position", label: "Understanding my legal position" },
  { value: "overstay_appeal", label: "Overstay appeal assistance" },
  { value: "next_steps_guidance", label: "Guidance on possible next steps" },
  { value: "professional_support", label: "Professional immigration support" },
  { value: "future_visa_planning", label: "Future visa planning" },
  { value: "general_guidance", label: "General immigration guidance" },
];

const CHALLENGE_OPTIONS: { value: Challenge; label: string }[] = [
  { value: "next_steps_unclear", label: "Understanding what to do next" },
  { value: "fear_of_ban", label: "Fear of being banned" },
  { value: "communication_difficulty", label: "Difficulty communicating with authorities" },
  { value: "financial_constraints", label: "Financial constraints" },
  { value: "delays_uncertainty", label: "Delays and uncertainty" },
  { value: "lack_of_guidance", label: "Lack of legal guidance" },
  { value: "stress_anxiety", label: "Stress / anxiety regarding status" },
  { value: "travel_restrictions", label: "Travel restrictions" },
  { value: "other", label: "Other" },
];

const REASSURING_LINES = [
  "Many immigration situations can still be addressed through proper processes.",
  "Providing accurate information helps us better understand your circumstances.",
  "Your information is treated confidentially.",
  "You are not alone in navigating this process.",
];

// Visible step count shown to the visitor (name → consent inclusive).
// Q4b (application-type follow-up) is a sub-step of Q4 — it does NOT
// bump the displayed counter.
const TOTAL_QUESTION_STEPS = 10;
const STEP_INTRO = 0;
const STEP_NAME = 1;
const STEP_CONTACT = 10;
const STEP_CONSENT = 11;
const STEP_SUCCESS = 12;

// Maps internal step index → 1-based displayed step number (1..10).
function displayedStep(step: number): number {
  if (step <= STEP_NAME) return 1;
  if (step <= 5) return step; // Q1..Q4 → 2..5
  if (step === 6) return 5; // Q4b sub-step
  if (step === 7) return 6; // Q5
  if (step === 8) return 7; // Q6
  if (step === 9) return 8; // Q7
  if (step === STEP_CONTACT) return 9;
  return 10; // consent
}

export default function OverstayAssessment() {
  const [step, setStep] = useState(STEP_INTRO);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    leadId: string;
    referenceNumber: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const sessionStartedAt = useMemo(() => new Date(), []);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleChallenge = (c: Challenge) =>
    setForm((f) => ({
      ...f,
      challenges: f.challenges.includes(c)
        ? f.challenges.filter((x) => x !== c)
        : [...f.challenges, c],
    }));

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(STEP_INTRO, s - 1));

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${BASE}/api/overstay-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          currentSituation: form.currentSituation,
          location: form.location,
          overstayDuration: form.overstayDuration,
          submittedApplication: form.submittedApplication,
          applicationType: form.applicationType.trim() || null,
          dhaCommunication: form.dhaCommunication,
          challenges: form.challenges,
          assistanceType: form.assistanceType,
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          whatsapp: form.whatsappOptIn ? form.phone.trim() || null : null,
          whatsappOptIn: form.whatsappOptIn,
          preferredChannel: form.preferredChannel,
          wantsToUploadDocs: form.wantsToUploadDocs,
          otherSituationDetail:
            form.currentSituation === "other"
              ? form.otherSituationDetail.trim() || null
              : null,
          consentAccepted: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
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

  const personalisedName = form.firstName.trim() || "there";
  const progressPct = (displayedStep(step) / TOTAL_QUESTION_STEPS) * 100;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BrandHeader variant="compact" />

      {/* Ambient brand glow — matches landing page hero pattern */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-radial from-primary/15 via-primary/[0.04] to-transparent blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[380px] w-[380px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        {step >= STEP_NAME && step < STEP_SUCCESS && (
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span>
                Step {displayedStep(step)} of {TOTAL_QUESTION_STEPS}
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

        <div className="relative rounded-2xl border border-card-border bg-card/80 p-6 backdrop-blur-md shadow-[0_20px_60px_-25px_rgba(56,189,248,0.25)] sm:p-10">
          {/* INTRO */}
          {step === STEP_INTRO && (
            <div className="space-y-7 text-center sm:text-left">
              <img
                src={brandLogo}
                alt="E-Migration Assist"
                style={{
                  filter:
                    "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
                }}
                className="mx-auto h-28 w-auto sm:mx-0 sm:h-32"
              />

              <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
                South African Overstay &{" "}
                <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                  Undesirable Status
                </span>{" "}
                Preliminary Assessment
              </h1>

              <p className="text-base text-muted-foreground sm:text-lg">
                Answer a few guided questions to better understand your current
                immigration circumstances and possible next procedural
                considerations.
              </p>

              <div className="rounded-xl border border-card-border bg-background/40 p-4 text-left text-sm text-muted-foreground">
                This guided assessment is designed to help identify and
                organise information relating to possible overstays,
                undesirable declarations, immigration status complications,
                and related circumstances under South African immigration
                processes.
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: ShieldCheck, label: "Confidential" },
                  { icon: HeartHandshake, label: "Non-judgemental" },
                  { icon: Sparkles, label: "Personalised" },
                ].map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-xl border border-card-border bg-background/40 px-3 py-2.5 text-sm text-muted-foreground"
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-foreground/90">{label}</span>
                  </div>
                ))}
              </div>

              <Button
                onClick={next}
                size="lg"
                className="w-full rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2 sm:w-auto"
              >
                Begin guided assessment
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <p className="text-xs text-muted-foreground">
                This is a preliminary guided intake. No legal conclusions are
                provided automatically — a human advisor reviews every case.
              </p>
            </div>
          )}

          {/* STEP 1 — Name */}
          {step === STEP_NAME && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                What is your first name?
              </h2>
              <p className="text-sm text-muted-foreground">
                We use your name to personalise the rest of the assessment.
              </p>
              <div>
                <Label htmlFor="fn" className="sr-only">First name</Label>
                <Input
                  id="fn"
                  autoFocus
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                  placeholder="e.g. Sarah"
                  className="h-12 rounded-xl border-card-border bg-background/60 text-base"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && form.firstName.trim()) next();
                  }}
                />
              </div>
              <NavRow onBack={back} onNext={next} nextDisabled={!form.firstName.trim()} />
            </div>
          )}

          {/* Q1 Situation */}
          {step === 2 && (
            <QuestionBlock
              greeting={`Thank you, ${personalisedName}.`}
              subtitle="Let's better understand your situation."
              question="What best describes your current situation?"
              reassurance={REASSURING_LINES[0]}
            >
              <OptionList
                value={form.currentSituation}
                options={SITUATION_OPTIONS}
                onSelect={(v) => {
                  update("currentSituation", v);
                  // Auto-advance for everything EXCEPT "other" — that one
                  // needs the visitor to type a custom reason first.
                  if (v !== "other") setTimeout(next, 200);
                }}
              />
              {form.currentSituation === "other" && (
                <div className="mt-4 space-y-2">
                  <Label
                    htmlFor="other-situation"
                    className="text-sm text-foreground/90"
                  >
                    Please briefly describe your situation
                  </Label>
                  <Input
                    id="other-situation"
                    autoFocus
                    placeholder="e.g. My permit conditions were changed unexpectedly…"
                    value={form.otherSituationDetail}
                    onChange={(e) =>
                      update("otherSituationDetail", e.target.value)
                    }
                    maxLength={500}
                    className="rounded-xl border-card-border bg-background/60"
                  />
                  <p className="text-xs text-muted-foreground">
                    A short sentence is enough — this helps us understand your
                    circumstances accurately.
                  </p>
                </div>
              )}
              <NavRow
                onBack={back}
                onNext={next}
                hideNext={form.currentSituation !== "other"}
                nextDisabled={
                  form.currentSituation === "other" &&
                  form.otherSituationDetail.trim().length < 3
                }
              />
            </QuestionBlock>
          )}

          {/* Q2 Location */}
          {step === 3 && (
            <QuestionBlock
              question="Are you currently inside or outside South Africa?"
              reassurance={REASSURING_LINES[1]}
            >
              <OptionList
                value={form.location}
                options={[
                  { value: "inside_sa", label: "Inside South Africa" },
                  { value: "outside_sa", label: "Outside South Africa" },
                ]}
                onSelect={(v) => {
                  update("location", v);
                  setTimeout(next, 200);
                }}
              />
              <NavRow onBack={back} hideNext />
            </QuestionBlock>
          )}

          {/* Q3 Duration */}
          {step === 4 && (
            <QuestionBlock
              question="Approximately how long have you overstayed?"
              reassurance={REASSURING_LINES[3]}
            >
              <OptionList
                value={form.overstayDuration}
                options={DURATION_OPTIONS}
                onSelect={(v) => {
                  update("overstayDuration", v);
                  setTimeout(next, 200);
                }}
              />
              <NavRow onBack={back} hideNext />
            </QuestionBlock>
          )}

          {/* Q4 Submitted application */}
          {step === 5 && (
            <QuestionBlock
              question="Did you attempt to submit any application before your visa expired?"
              reassurance={REASSURING_LINES[1]}
            >
              <OptionList
                value={form.submittedApplication}
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Unsure" },
                ]}
                onSelect={(v) => {
                  update("submittedApplication", v);
                  setTimeout(() => (v === "yes" ? setStep(6) : setStep(7)), 200);
                }}
              />
              <NavRow onBack={back} hideNext />
            </QuestionBlock>
          )}

          {/* Q4b application type */}
          {step === 6 && (
            <QuestionBlock
              question="What type of application did you submit?"
              reassurance="Even partial details help us better understand your case."
            >
              <Input
                value={form.applicationType}
                onChange={(e) => update("applicationType", e.target.value)}
                placeholder="e.g. Critical-skills waiver, Spousal visa renewal…"
                className="h-12 rounded-xl border-card-border bg-background/60 text-base"
                autoFocus
              />
              <NavRow
                onBack={() => setStep(5)}
                onNext={() => setStep(7)}
                nextDisabled={!form.applicationType.trim()}
              />
            </QuestionBlock>
          )}

          {/* Q5 DHA communication */}
          {step === 7 && (
            <QuestionBlock
              question="Have you received any written communication from the Department of Home Affairs?"
              reassurance={REASSURING_LINES[2]}
            >
              <OptionList
                value={form.dhaCommunication}
                options={[
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Unsure" },
                ]}
                onSelect={(v) => {
                  update("dhaCommunication", v);
                  update("wantsToUploadDocs", v === "yes");
                  setTimeout(next, 200);
                }}
              />
              {form.dhaCommunication === "yes" && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-primary">
                  Great — after this assessment you'll be able to securely
                  upload supporting documents (undesirable declaration,
                  rejection letter, passport stamp, visa copy, VFS
                  communication, etc.).
                </div>
              )}
              <NavRow
                onBack={() => setStep(form.submittedApplication === "yes" ? 6 : 5)}
                hideNext={!form.dhaCommunication}
                onNext={next}
              />
            </QuestionBlock>
          )}

          {/* Q6 Challenges (multi-select) */}
          {step === 8 && (
            <QuestionBlock
              question="What has been your biggest challenge so far?"
              hint="Select all that apply."
              reassurance={REASSURING_LINES[3]}
            >
              <div className="space-y-2">
                {CHALLENGE_OPTIONS.map((c) => {
                  const checked = form.challenges.includes(c.value);
                  return (
                    <label
                      key={c.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-all hover-elevate ${
                        checked
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-card-border bg-background/40 text-muted-foreground"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleChallenge(c.value)}
                      />
                      <span className="text-foreground/90">{c.label}</span>
                    </label>
                  );
                })}
              </div>
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={form.challenges.length === 0}
              />
            </QuestionBlock>
          )}

          {/* Q7 Assistance type */}
          {step === 9 && (
            <QuestionBlock
              question="What type of assistance are you looking for?"
              reassurance={REASSURING_LINES[0]}
            >
              <OptionList
                value={form.assistanceType}
                options={ASSISTANCE_OPTIONS}
                onSelect={(v) => {
                  update("assistanceType", v);
                  setTimeout(next, 200);
                }}
              />
              <NavRow onBack={back} hideNext />
            </QuestionBlock>
          )}

          {/* CONTACT */}
          {step === STEP_CONTACT && (
            <QuestionBlock
              question="How can we reach you privately?"
              reassurance="Your contact details are kept confidential and used only to follow up on your assessment."
            >
              <div className="space-y-4">
                <div>
                  <Label htmlFor="email" className="text-foreground/90">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
                <div>
                  <Label htmlFor="phone" className="text-foreground/90">
                    Phone / WhatsApp (optional)
                  </Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder="+27 …"
                    className="mt-1 h-11 rounded-xl border-card-border bg-background/60"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-card-border bg-background/40 p-3 text-sm text-foreground/90 hover-elevate">
                  <Checkbox
                    checked={form.whatsappOptIn}
                    onCheckedChange={(v) => update("whatsappOptIn", Boolean(v))}
                  />
                  <span>I'm happy to be contacted on WhatsApp.</span>
                </label>
                <div>
                  <Label className="text-foreground/90">
                    Preferred contact channel
                  </Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["email", "whatsapp"] as Channel[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => update("preferredChannel", c)}
                        className={`rounded-xl border p-3 text-sm capitalize transition-all hover-elevate ${
                          form.preferredChannel === c
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-card-border bg-background/40 text-muted-foreground"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={
                  !form.email.trim() || !/.+@.+\..+/.test(form.email)
                }
              />
            </QuestionBlock>
          )}

          {/* CONSENT */}
          {step === STEP_CONSENT && (
            <div className="space-y-6">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                One last thing,{" "}
                <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                  {personalisedName}
                </span>
                .
              </h2>

              {/* Personalised reassurance — confirms remedies exist based on answers */}
              <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 shadow-[0_0_40px_-20px_rgba(56,189,248,0.45)]">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  Based on your answers
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {buildRemedySummary(form, personalisedName)}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {buildSituationHighlights(form).map((line, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-sm text-muted-foreground">
                We'll secure your information and prepare your case for a
                structured review by our team. You'll receive a reference
                number on the next screen — keep it safe.
              </p>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-card-border bg-background/40 p-4 text-sm text-foreground/90 hover-elevate">
                <Checkbox
                  checked={form.consentAccepted}
                  onCheckedChange={(v) => update("consentAccepted", Boolean(v))}
                  className="mt-0.5"
                />
                <span>
                  I confirm the information provided is accurate to the best of
                  my knowledge, and I consent to E-Migration Assist storing
                  these details to assess my circumstances and contact me about
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
                  disabled={!form.consentAccepted || submitting}
                  className="rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2"
                >
                  {submitting ? "Submitting…" : "Request Early Assistance"}
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
                    Thank you, {personalisedName}.
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Your information has been securely captured.
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
                      <><Check className="mr-1 h-3 w-3" /> Copied</>
                    ) : (
                      <><Copy className="mr-1 h-3 w-3" /> Copy</>
                    )}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Keep this reference. We may use it when inviting you to
                  continue onboarding into the E-Migration Assist platform.
                </p>
              </div>

              <p className="text-sm text-muted-foreground">
                Based on the information provided, your situation may require a
                structured review and guided next-step support. You may soon be
                invited to register or subscribe to the E-Migration Assist case
                management platform.
              </p>

              {form.wantsToUploadDocs && (
                <div className="rounded-2xl border border-card-border bg-background/40 p-5">
                  <h3 className="mb-1 font-display text-base font-semibold text-foreground">
                    Upload supporting documents (optional)
                  </h3>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Undesirable declaration, rejection letter, passport stamp,
                    visa copy, VFS communication, or related documents.
                  </p>
                  <DocumentUploader
                    leadId={result.leadId}
                    sessionStartedAt={sessionStartedAt}
                  />
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  className="rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover-elevate active-elevate-2"
                >
                  <Link href={`/status?ref=${result.referenceNumber}`}>
                    Check my status
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 backdrop-blur-md hover-elevate"
                >
                  <Link href="/">
                    <HomeIcon className="mr-2 h-4 w-4" /> Back to home
                  </Link>
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

// Builds a 1-sentence reassurance line confirming remedies exist,
// lightly tailored to the answers given. We never quote a specific
// statute or outcome — language stays in "may be available" register.
function buildRemedySummary(form: FormState, name: string): string {
  const leadIn =
    name && name !== "there" ? `${name}, based on what you've shared, ` : "Based on what you've shared, ";

  const hasUndesirable = form.currentSituation === "undesirable_declaration";
  const hasOverstay =
    form.currentSituation === "overstayed_after_expiry" ||
    form.currentSituation === "visa_expired" ||
    form.currentSituation === "missed_departure_deadline";

  if (hasUndesirable) {
    return (
      leadIn +
      "there are recognised procedural remedies for undesirable declarations under South African immigration processes, and our team can help you understand which paths may apply to your circumstances."
    );
  }
  if (hasOverstay) {
    return (
      leadIn +
      "your circumstances fall within situations that can typically be addressed through structured immigration processes — there are remedies available and our team can help you identify the most appropriate next steps."
    );
  }
  return (
    leadIn +
    "your circumstances fall within situations our team is equipped to review — there are procedural options that may be available to you, and we'll help you identify the most appropriate next steps."
  );
}

// Echoes back the visitor's key answers so they can see we listened.
function buildSituationHighlights(form: FormState): string[] {
  const lines: string[] = [];
  const sit = SITUATION_OPTIONS.find((s) => s.value === form.currentSituation);
  if (sit) {
    const detail =
      form.currentSituation === "other" && form.otherSituationDetail.trim()
        ? `Situation: ${form.otherSituationDetail.trim()}`
        : `Situation: ${sit.label}`;
    lines.push(detail);
  }
  if (form.location) {
    lines.push(
      form.location === "inside_sa"
        ? "Currently inside South Africa"
        : "Currently outside South Africa",
    );
  }
  if (form.overstayDuration) {
    const dur = DURATION_OPTIONS.find((d) => d.value === form.overstayDuration);
    if (dur) lines.push(`Overstay window: ${dur.label}`);
  }
  if (form.assistanceType) {
    const asst = ASSISTANCE_OPTIONS.find(
      (a) => a.value === form.assistanceType,
    );
    if (asst) lines.push(`Support requested: ${asst.label}`);
  }
  return lines;
}

function OptionList<T extends string>({
  value,
  options,
  onSelect,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onSelect: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onSelect(o.value)}
            className={`flex w-full items-center justify-between rounded-xl border p-4 text-left text-sm transition-all hover-elevate active-elevate-2 ${
              selected
                ? "border-primary/60 bg-primary/15 text-foreground"
                : "border-card-border bg-background/40 text-foreground/90"
            }`}
          >
            <span>{o.label}</span>
            <ArrowRight
              className={`h-4 w-4 transition ${
                selected ? "text-primary" : "text-muted-foreground"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
