import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandHeader } from "@/components/brand-header";
import { DocumentUploader } from "@/components/DocumentUploader";
import {
  ArrowRight,
  ArrowLeft,
  Shield,
  Heart,
  Sparkles,
  Check,
  Copy,
  Home as HomeIcon,
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

type Channel = "email" | "whatsapp" | "phone";

interface FormState {
  firstName: string;
  currentSituation: Situation | null;
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

const TOTAL_QUESTION_STEPS = 9; // Q1..Q7 + contact + consent
const STEP_INTRO = 0;
const STEP_NAME = 1;

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

  // After Q4 (step 5) — if user said NO/Unsure to submittedApplication, skip applicationType
  // Step mapping:
  //  0 intro, 1 name, 2 Q1 situation, 3 Q2 location, 4 Q3 duration,
  //  5 Q4 submittedApplication, 6 Q4b applicationType (conditional),
  //  7 Q5 dhaCommunication, 8 Q6 challenges, 9 Q7 assistanceType,
  //  10 contact, 11 consent + submit, 12 success
  const STEP_SUCCESS = 12;
  const STEP_CONSENT = 11;
  const STEP_CONTACT = 10;

  const advanceFromQ4 = () => {
    if (form.submittedApplication === "yes") next();
    else setStep(7); // skip applicationType
  };

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
  const progressPct =
    step <= STEP_NAME ? 0 : Math.min(95, ((step - 1) / TOTAL_QUESTION_STEPS) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <BrandHeader />

      {/* Subtle ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        {step > STEP_NAME && step < STEP_SUCCESS && (
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>Step {Math.min(step - 1, TOTAL_QUESTION_STEPS)} of {TOTAL_QUESTION_STEPS}</span>
              <span>Confidential & secure</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <Card className="border-white/10 bg-slate-900/70 p-6 backdrop-blur sm:p-10">
          {/* INTRO */}
          {step === STEP_INTRO && (
            <div className="space-y-6">
              <Badge className="bg-teal-500/15 text-teal-300 ring-1 ring-teal-400/40">
                Overstay & Undesirable Assessment
              </Badge>
              <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                You may still have options available.
              </h1>
              <p className="text-base text-slate-300 sm:text-lg">
                If you have overstayed in South Africa or received an
                undesirable declaration, this guided assessment may help you
                better understand your circumstances and possible next steps.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Shield, label: "Confidential" },
                  { icon: Heart, label: "Non-judgemental" },
                  { icon: Sparkles, label: "Personalised" },
                ].map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-300"
                  >
                    <Icon className="h-4 w-4 text-teal-300" />
                    {label}
                  </div>
                ))}
              </div>
              <Button
                onClick={next}
                size="lg"
                className="w-full bg-teal-500 text-white hover:bg-teal-400 sm:w-auto"
              >
                Begin guided assessment
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-xs text-slate-500">
                This is a preliminary guided intake. No legal conclusions are
                provided automatically — a human advisor reviews every case.
              </p>
            </div>
          )}

          {/* STEP 1 — Name */}
          {step === STEP_NAME && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-white">
                What is your first name?
              </h2>
              <p className="text-sm text-slate-400">
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
                  className="h-12 border-white/10 bg-slate-950/60 text-base text-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && form.firstName.trim()) next();
                  }}
                />
              </div>
              <NavRow
                onBack={back}
                onNext={next}
                nextDisabled={!form.firstName.trim()}
              />
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
                  setTimeout(next, 200);
                }}
              />
              <NavRow onBack={back} hideNext />
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
                  setTimeout(
                    () => (v === "yes" ? setStep(6) : setStep(7)),
                    200,
                  );
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
                className="h-12 border-white/10 bg-slate-950/60 text-base text-white"
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
                <div className="rounded-xl border border-teal-400/20 bg-teal-500/5 p-4 text-sm text-teal-200">
                  Great — after you complete this assessment you'll be able to
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
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-all ${
                        checked
                          ? "border-teal-400/60 bg-teal-500/10 text-white"
                          : "border-white/10 bg-slate-950/40 text-slate-200 hover:border-white/20 hover:bg-slate-900/60"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleChallenge(c.value)}
                      />
                      <span>{c.label}</span>
                    </label>
                  );
                })}
              </div>
              <NavRow onBack={back} onNext={next} />
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

          {/* STEP CONTACT */}
          {step === STEP_CONTACT && (
            <QuestionBlock
              question="How can we reach you privately?"
              reassurance="Your contact details are kept confidential and used only to follow up on your assessment."
            >
              <div className="space-y-4">
                <div>
                  <Label htmlFor="email" className="text-slate-300">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 h-11 border-white/10 bg-slate-950/60 text-white"
                  />
                </div>
                <div>
                  <Label htmlFor="phone" className="text-slate-300">
                    Phone / WhatsApp (optional)
                  </Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder="+27 ..."
                    className="mt-1 h-11 border-white/10 bg-slate-950/60 text-white"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-200">
                  <Checkbox
                    checked={form.whatsappOptIn}
                    onCheckedChange={(v) =>
                      update("whatsappOptIn", Boolean(v))
                    }
                  />
                  <span>I'm happy to be contacted on WhatsApp.</span>
                </label>
                <div>
                  <Label className="text-slate-300">
                    Preferred contact channel
                  </Label>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(["email", "whatsapp", "phone"] as Channel[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => update("preferredChannel", c)}
                        className={`rounded-xl border p-3 text-sm capitalize transition-all ${
                          form.preferredChannel === c
                            ? "border-teal-400/60 bg-teal-500/15 text-teal-200"
                            : "border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20"
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

          {/* CONSENT + SUBMIT */}
          {step === STEP_CONSENT && (
            <div className="space-y-6">
              <h2 className="text-2xl font-semibold text-white">
                One last thing, {personalisedName}.
              </h2>
              <p className="text-sm text-slate-300">
                Based on what you've shared, your situation may require a
                structured review and guided next-step support. We'll secure
                your information and prepare your case for review.
              </p>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-200">
                <Checkbox
                  checked={form.consentAccepted}
                  onCheckedChange={(v) =>
                    update("consentAccepted", Boolean(v))
                  }
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
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {submitError}
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <Button
                  variant="ghost"
                  onClick={back}
                  className="text-slate-300 hover:text-white"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={submit}
                  disabled={!form.consentAccepted || submitting}
                  className="bg-teal-500 text-white hover:bg-teal-400"
                >
                  {submitting ? "Submitting…" : "Request Early Assistance"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              {/* Honeypot — must NOT be filled by humans */}
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
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500/20 ring-1 ring-teal-400/40">
                  <Check className="h-6 w-6 text-teal-300" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-white">
                    Thank you, {personalisedName}.
                  </h2>
                  <p className="text-sm text-slate-400">
                    Your information has been securely captured.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-teal-400/30 bg-teal-500/5 p-5">
                <p className="text-xs uppercase tracking-wide text-teal-300">
                  Your reference number
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="text-xl font-semibold text-white">
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
                    className="text-teal-200 hover:text-white"
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
                <p className="mt-3 text-xs text-slate-400">
                  Keep this reference. We may use it when inviting you to
                  continue onboarding into the E-Migration Assist platform.
                </p>
              </div>

              <p className="text-sm text-slate-300">
                Based on the information provided, your situation may require a
                structured review and guided next-step support. You may soon be
                invited to register or subscribe to the E-Migration Assist case
                management platform.
              </p>

              {form.wantsToUploadDocs && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                  <h3 className="mb-1 text-base font-semibold text-white">
                    Upload supporting documents (optional)
                  </h3>
                  <p className="mb-4 text-xs text-slate-400">
                    Undesirable declaration, rejection letter, passport stamp,
                    visa copy, VFS communication or related documents.
                  </p>
                  <DocumentUploader
                    leadId={result.leadId}
                    sessionStartedAt={sessionStartedAt}
                  />
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild className="bg-teal-500 text-white hover:bg-teal-400">
                  <Link href={`/status?ref=${result.referenceNumber}`}>
                    Check my status
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="text-slate-300 hover:text-white">
                  <Link href="/">
                    <HomeIcon className="mr-2 h-4 w-4" /> Back to home
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </Card>
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
          className="text-slate-400 hover:text-white"
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
          className="bg-teal-500 text-white hover:bg-teal-400"
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
        <p className="text-base font-medium text-teal-300">{greeting}</p>
      )}
      {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
      <h2 className="text-xl font-semibold text-white sm:text-2xl">
        {question}
      </h2>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {children}
      {reassurance && (
        <p className="border-l-2 border-teal-400/40 pl-3 text-xs italic text-slate-400">
          {reassurance}
        </p>
      )}
    </div>
  );
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
            className={`flex w-full items-center justify-between rounded-xl border p-4 text-left text-sm transition-all ${
              selected
                ? "border-teal-400/70 bg-teal-500/15 text-white"
                : "border-white/10 bg-slate-950/40 text-slate-200 hover:border-white/30 hover:bg-slate-900/60"
            }`}
          >
            <span>{o.label}</span>
            <ArrowRight
              className={`h-4 w-4 transition ${
                selected ? "text-teal-300" : "text-slate-500"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
