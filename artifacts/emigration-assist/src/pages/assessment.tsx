import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateLead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { BrandHeader } from "@/components/brand-header";
import { trackEvent } from "@/lib/analytics";
import { trackPixel } from "@/lib/metaPixel";
import { DocumentUploader } from "@/components/DocumentUploader";
import { CountryCombobox } from "@/components/country-combobox";
import { WhatsAppInput } from "@/components/whatsapp-input";
import { findByIso, findByName } from "@/lib/countries";
import { LegalLink } from "@/components/legal-modals";
import {
  buildPersonalisedNote,
  type PersonalisedNoteInput,
} from "@/lib/personalisedNote";
import { Loader2, MailCheck, Phone, ShieldCheck } from "lucide-react";

const BASE_URL = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "");

const assessmentSchema = z.object({
  // Step 1
  nationality: z.string().min(2, "Please select your nationality"),
  countryOfResidence: z.string().optional(),
  insideSouthAfrica: z.enum(["inside", "outside"], {
    required_error: "Please tell us where you are currently located",
  }),

  // Step 2
  immigrationSituation: z.enum([
    "valid",
    "expired",
    "overstay",
    "undesirable",
    "prohibited",
    "visa_required",
    "unknown",
  ]),
  passportStatus: z
    .enum(["valid", "expired", "unsure", "lost", "none"])
    .optional(),

  // Step 3 (Conditional context only — no documents question here in V2)
  visaExpiryDate: z.string().optional(),
  exitDate: z.string().optional(),
  borderDocumentIssued: z.string().optional(),
  overstayReason: z
    .enum(["medical", "accident", "family_emergency", "admin_delay", "other"])
    .optional(),
  overstayReasonNotes: z.string().optional(),
  previousOverstay: z.enum(["yes", "no"]).optional(),
  visaHistory: z.string().optional(),

  // Step 4
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Invalid email address"),
  whatsapp: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val || val.trim() === "") return true;
        return /^\+\d{8,15}$/.test(val.trim());
      },
      { message: "Enter a valid WhatsApp number for the selected country." },
    ),
  preferredContactMethod: z
    .enum(["email", "whatsapp", "phone"])
    .default("email"),

  // Step 6 — Terms gate
  consentAccepted: z
    .boolean()
    .refine((val) => val === true, "You must accept the terms"),

  // Step 7 — Documents gate (Yes/No). Optional in the schema because
  // step 6's Continue button is type=submit and zod-resolver would
  // otherwise block submission before the user has reached step 7.
  // The Submit/Finalize buttons enforce the choice with their own
  // disabled gates (`!wantsDocs`).
  wantsToUploadDocuments: z.enum(["yes", "no"]).optional(),
});

type AssessmentFormValues = z.infer<typeof assessmentSchema>;

interface OtpRequestState {
  otpId: string;
  deliveredVia: "email" | "whatsapp";
  deliveryNote: string | null;
  expiresAt: string;
  devCode?: string;
}

export function Assessment() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);

  // OTP state ---------------------------------------------------------------
  const [otpRequest, setOtpRequest] = useState<OtpRequestState | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpChannel, setOtpChannel] = useState<"email" | "whatsapp">("email");
  const [otpRequesting, setOtpRequesting] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [verifiedOtpId, setVerifiedOtpId] = useState<string | null>(null);

  const [createdLead, setCreatedLead] = useState<{
    id: string;
    referenceNumber: string;
  } | null>(null);
  const [documentsUploaded, setDocumentsUploaded] = useState(0);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState(false);

  // Session-local cutoff for the document scope filter. Anything uploaded
  // BEFORE this moment (e.g. by a previous session for the same email)
  // must not appear when this user reaches step 8.
  const sessionStartedAtRef = useRef<Date>(new Date());

  const createLead = useCreateLead();

  useEffect(() => {
    document.title = "Immigration Assessment | E-Migration Assist";
    trackEvent("assessment_started");
  }, []);

  const form = useForm<AssessmentFormValues>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: {
      immigrationSituation: "valid",
      passportStatus: "valid",
      preferredContactMethod: "email",
      consentAccepted: false,
      whatsapp: "",
      nationality: "",
      countryOfResidence: "",
    },
    mode: "onTouched",
  });

  const situation = form.watch("immigrationSituation");
  const insideSA = form.watch("insideSouthAfrica");
  const preferred = form.watch("preferredContactMethod");
  const whatsappValue = form.watch("whatsapp");
  const emailValue = form.watch("email");
  const wantsDocs = form.watch("wantsToUploadDocuments");

  const [nationalityIso, setNationalityIso] = useState<string | undefined>();
  const [residenceIso, setResidenceIso] = useState<string | undefined>();

  // Inside-SA defaulting + outside-SA exclusion logic. When the user
  // says "inside", residence auto-fills to South Africa (only if empty).
  // When they switch to "outside", we proactively clear any South Africa
  // selection so the (now-hidden) ZA option isn't a stale value sent on
  // submit.
  useEffect(() => {
    if (insideSA === "inside") {
      const za = findByIso("ZA");
      if (za && !form.getValues("countryOfResidence")) {
        setResidenceIso("ZA");
        form.setValue("countryOfResidence", za.name, { shouldValidate: true });
      }
    } else if (insideSA === "outside") {
      const current = form.getValues("countryOfResidence");
      if (current && findByName(current)?.iso2 === "ZA") {
        setResidenceIso(undefined);
        form.setValue("countryOfResidence", "", { shouldValidate: true });
      }
    }
  }, [insideSA, form]);

  useEffect(() => {
    if (step === 5 && !otpRequest) {
      setOtpChannel(preferred === "whatsapp" ? "whatsapp" : "email");
    }
  }, [step, preferred, otpRequest]);

  // Step numbering is dynamic: when the user opts out of documents we
  // skip the upload step entirely (steps 1–7, ending at the summary).
  // When they opt in, we render the upload step (steps 1–8). Until the
  // user has answered the gate, we optimistically show 8 so the bar
  // doesn't jump backwards on selection.
  const totalSteps = wantsDocs === "no" ? 7 : 8;

  // Per-step indices used by the JSX. After the gate (step 7), the
  // summary lives at step 7 (no docs) or step 8 (with docs).
  const SUMMARY_STEP = wantsDocs === "no" ? 7 : 8;
  const UPLOAD_STEP = 7; // Only rendered when wantsDocs === "yes".

  const nextStep = async () => {
    let fieldsToValidate: Array<keyof AssessmentFormValues> = [];

    if (step === 1)
      fieldsToValidate = [
        "nationality",
        "countryOfResidence",
        "insideSouthAfrica",
      ];
    if (step === 2)
      fieldsToValidate = ["immigrationSituation", "passportStatus"];
    if (step === 4)
      fieldsToValidate = [
        "fullName",
        "email",
        "whatsapp",
        "preferredContactMethod",
      ];

    const isValid = await form.trigger(fieldsToValidate as any);
    if (!isValid) return;

    setStep((s) => s + 1);
    window.scrollTo(0, 0);
  };

  const prevStep = () => {
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo(0, 0);
  };

  // OTP request -------------------------------------------------------------
  const requestOtp = async () => {
    setOtpError(null);
    setOtpRequesting(true);
    try {
      const res = await fetch(`${BASE_URL}/api/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: otpChannel,
          email: emailValue,
          whatsapp: whatsappValue || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setOtpError(json?.error ?? "Could not send verification code.");
        return;
      }
      setOtpRequest({
        otpId: json.otpId,
        deliveredVia: json.deliveredVia,
        deliveryNote: json.deliveryNote ?? null,
        expiresAt: json.expiresAt,
        devCode: json.devCode,
      });
    } catch (err) {
      setOtpError("Network error — please try again.");
    } finally {
      setOtpRequesting(false);
    }
  };

  // OTP verify --------------------------------------------------------------
  const verifyOtp = async () => {
    if (!otpRequest) return;
    setOtpError(null);
    setOtpVerifying(true);
    try {
      const res = await fetch(`${BASE_URL}/api/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpId: otpRequest.otpId, code: otpCode.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        const remaining =
          typeof json?.remaining === "number"
            ? ` (${json.remaining} ${json.remaining === 1 ? "attempt" : "attempts"} remaining)`
            : "";
        setOtpError((json?.error ?? "Incorrect code.") + remaining);
        return;
      }
      setVerifiedOtpId(json.otpId);
      toast({ title: "Verified", description: "Your contact has been verified." });
      setStep(6);
      window.scrollTo(0, 0);
    } catch (err) {
      setOtpError("Network error — please try again.");
    } finally {
      setOtpVerifying(false);
    }
  };

  // Lead creation — the row is committed AFTER terms acceptance but
  // BEFORE the documents gate, so the documents step (when chosen) has
  // a real lead.id to attach uploads to.  finalize:false defers the
  // confirmation send until the very end of the flow.
  const submitLead = (data: AssessmentFormValues) => {
    if (createdLead) {
      // Already saved this session — just advance to the documents gate.
      setStep(7);
      window.scrollTo(0, 0);
      return;
    }
    if (!verifiedOtpId) {
      toast({
        title: "Verification missing",
        description: "Please verify your contact before continuing.",
        variant: "destructive",
      });
      setStep(5);
      return;
    }

    const { overstayReasonNotes, insideSouthAfrica, ...rest } = data;
    const visaHistoryWithNotes = overstayReasonNotes
      ? [rest.visaHistory, `Overstay context: ${overstayReasonNotes}`]
          .filter(Boolean)
          .join("\n\n")
      : rest.visaHistory;

    const submitData = {
      ...rest,
      visaHistory: visaHistoryWithNotes,
      currentlyInSouthAfrica: insideSouthAfrica === "inside",
      verifiedOtpId,
      // Defer confirmation to the explicit finalize step. No outbound
      // email/WhatsApp is sent on this call.
      finalize: false,
    } as any;

    createLead.mutate(
      { data: submitData },
      {
        onSuccess: (result) => {
          trackEvent("assessment_completed", {
            referenceNumber: result.referenceNumber,
          });
          setCreatedLead({
            id: result.id,
            referenceNumber: result.referenceNumber,
          });
          // Move into the documents-gate step.
          setStep(7);
          window.scrollTo(0, 0);
        },
        onError: (err: any) => {
          const data = err?.response?.data;
          if (
            err?.response?.status === 409 ||
            data?.error === "already_registered"
          ) {
            const ref = data?.referenceNumber;
            toast({
              title: "You're already registered",
              description: data?.message
                ? ref
                  ? `${data.message} Your reference is ${ref}.`
                  : data.message
                : "This email or contact number is already registered with us.",
              variant: "destructive",
            });
            if (ref) {
              setLocation(`/status?reference=${encodeURIComponent(ref)}`);
            }
            return;
          }
          const msg =
            data?.error ??
            "There was an issue saving your information. Please try again.";
          toast({
            title: "Submission could not be completed",
            description: msg,
            variant: "destructive",
          });
        },
      },
    );
  };

  // Finalize — flips the lead from "draft" (no confirmation sent) to
  // "final" by hitting the deferred dispatcher, then reveals the
  // summary page. Called from BOTH the "no documents" branch (skip
  // straight from the gate) AND the upload-completion branch.
  const finalizeAndShowSummary = async () => {
    if (!createdLead || finalizing) return;
    setFinalizing(true);
    try {
      if (!finalized) {
        try {
          const res = await fetch(
            `${BASE_URL}/api/leads/${createdLead.id}/finalize`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            },
          );
          setFinalized(true);
          // Meta Pixel: only count a Lead on a genuine success response
          // (fetch resolves on 4xx/5xx too). No PII — descriptive params only.
          if (res.ok) {
            trackPixel("Lead", {
              content_name: "Assessment Submission",
              content_category: "assessment",
            });
          }
        } catch (err) {
          // Confirmation send is non-blocking — never let a network blip
          // strand the user on the upload screen.
        }
      }
      // Phase 1 (Q2 = X): the reference number is intentionally never
      // displayed inside the assessment flow. Redirect straight to the
      // public thank-you page, which is the single confirmation surface
      // that reveals the reference + personalised note. The in-page
      // summary block below is left in place as a defensive fallback in
      // case `referenceNumber` is somehow missing.
      if (createdLead.referenceNumber) {
        setLocation(`/thank-you/${createdLead.referenceNumber}`);
        return;
      }
      setStep(SUMMARY_STEP);
      window.scrollTo(0, 0);
    } finally {
      setFinalizing(false);
    }
  };

  const personalised = useMemo(() => {
    const v = form.getValues();
    const input: PersonalisedNoteInput = {
      fullName: v.fullName,
      immigrationSituation: v.immigrationSituation,
      passportStatus: v.passportStatus,
      currentlyInSouthAfrica:
        v.insideSouthAfrica === "inside"
          ? true
          : v.insideSouthAfrica === "outside"
            ? false
            : null,
      documentsUploaded,
    };
    return buildPersonalisedNote(input);
  }, [createdLead, documentsUploaded, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Showing the upload UI on step 7 only when the user opted in; the
  // same step number renders the summary when they opted out.
  const onSummaryStep = step === SUMMARY_STEP && createdLead;
  const onUploadStep =
    step === UPLOAD_STEP && createdLead && wantsDocs === "yes";
  const onGateStep =
    step === 7 && createdLead && (wantsDocs === undefined || wantsDocs === "no");
  // (When wantsDocs === "no" the gate radio still renders on step 7 so
  // the user can flip back to "yes" before clicking Continue.)

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <BrandHeader variant="compact" />
        <div className="space-y-4">
          <h1 className="text-3xl font-display font-semibold text-center">
            Your Preliminary Assessment
          </h1>
          <Progress
            value={(Math.min(step, totalSteps) / totalSteps) * 100}
            className="h-2"
          />
          <p className="text-center text-sm text-muted-foreground">
            Step {Math.min(step, totalSteps)} of {totalSteps}
          </p>
        </div>

        <Card className="p-6 md:p-8 shadow-lg border-border/40">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(submitLead)}
              className="space-y-8"
            >
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">
                    Basic Information
                  </h2>

                  <FormField
                    control={form.control}
                    name="nationality"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>
                          Nationality (Country of Citizenship)
                        </FormLabel>
                        <FormControl>
                          <CountryCombobox
                            value={
                              nationalityIso ?? findByName(field.value)?.iso2
                            }
                            ariaInvalid={fieldState.invalid}
                            onChange={(iso2) => {
                              setNationalityIso(iso2);
                              field.onChange(findByIso(iso2)?.name ?? "");
                            }}
                            placeholder="Select your country of citizenship"
                            testId="select-nationality"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="insideSouthAfrica"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>
                          Where are you currently located?
                        </FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                            className="flex flex-col space-y-2"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem
                                  value="inside"
                                  data-testid="radio-inside-sa"
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">
                                I am currently inside South Africa
                              </FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem
                                  value="outside"
                                  data-testid="radio-outside-sa"
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">
                                I am currently outside South Africa
                              </FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="countryOfResidence"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>Current Country of Residence</FormLabel>
                        <FormControl>
                          <CountryCombobox
                            value={
                              residenceIso ?? findByName(field.value)?.iso2
                            }
                            ariaInvalid={fieldState.invalid}
                            onChange={(iso2) => {
                              setResidenceIso(iso2);
                              field.onChange(findByIso(iso2)?.name ?? "");
                            }}
                            placeholder="Where do you currently live?"
                            testId="select-residence"
                            // When the user is OUTSIDE South Africa, ZA
                            // must not be a selectable option.  V2 spec.
                            excludeIso={
                              insideSA === "outside" ? ["ZA"] : undefined
                            }
                          />
                        </FormControl>
                        {insideSA === "inside" && (
                          <FormDescription>
                            Defaulted to South Africa — change it if you live elsewhere.
                          </FormDescription>
                        )}
                        {insideSA === "outside" && (
                          <FormDescription>
                            South Africa is hidden because you indicated you are currently outside the country.
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">
                    Current Situation
                  </h2>

                  <FormField
                    control={form.control}
                    name="immigrationSituation"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>
                          Which best describes your situation?
                        </FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col space-y-2"
                          >
                            {[
                              {
                                value: "valid",
                                label: "I currently hold a valid visa",
                              },
                              {
                                value: "expired",
                                label: "My visa is expiring or has expired",
                              },
                              {
                                value: "overstay",
                                label:
                                  "I have remained beyond my visa period (overstay)",
                              },
                              {
                                value: "visa_required",
                                label:
                                  "I require a visa or want to apply for a visa",
                              },
                              {
                                value: "undesirable",
                                label: "I have been declared undesirable",
                              },
                              {
                                value: "prohibited",
                                label:
                                  "I may have been listed as a prohibited person",
                              },
                              {
                                value: "unknown",
                                label: "Unsure / prefer further review",
                              },
                            ].map((opt) => (
                              <FormItem
                                key={opt.value}
                                className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors"
                              >
                                <FormControl>
                                  <RadioGroupItem value={opt.value} />
                                </FormControl>
                                <FormLabel className="font-normal cursor-pointer w-full">
                                  {opt.label}
                                </FormLabel>
                              </FormItem>
                            ))}
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="passportStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Is your passport valid for at least 6 months from today?
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select an option" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="valid">
                              Yes, valid for 6 months or more
                            </SelectItem>
                            <SelectItem value="expired">
                              No, expires in less than 6 months
                            </SelectItem>
                            <SelectItem value="unsure">
                              I am not sure
                            </SelectItem>
                            <SelectItem value="none">
                              I do not currently have a passport
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">
                    Additional Context
                  </h2>

                  {(situation === "expired" || situation === "overstay") && (
                    <FormField
                      control={form.control}
                      name="visaExpiryDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Visa Expiry Date</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              {...field}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {situation === "overstay" && (
                    <>
                      <FormField
                        control={form.control}
                        name="overstayReason"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reason for the overstay</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a reason" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="medical">Medical reasons</SelectItem>
                                <SelectItem value="accident">Accident</SelectItem>
                                <SelectItem value="family_emergency">Family emergency</SelectItem>
                                <SelectItem value="admin_delay">Administrative delay</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="overstayReasonNotes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Additional context (optional)</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Briefly describe the circumstances..."
                                className="resize-none"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="previousOverstay"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Have you had a previous overstay?</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select an option" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="no">No</SelectItem>
                                <SelectItem value="yes">Yes</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  <FormField
                    control={form.control}
                    name="visaHistory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Brief Visa History (optional)</FormLabel>
                        <FormDescription>
                          Any previous visas held or applications submitted.
                        </FormDescription>
                        <FormControl>
                          <Textarea
                            placeholder="e.g. Held a study visa from 2018 to 2021..."
                            className="resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 4 && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
                  data-testid="step-contact"
                >
                  <h2 className="text-xl font-medium border-b pb-2">
                    Contact Details
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    We'll send a one-time verification code to confirm this is really you. Your reference number will be issued at the end.
                  </p>

                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Your full name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="whatsapp"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>WhatsApp Number (Optional)</FormLabel>
                        <FormControl>
                          <WhatsAppInput
                            value={field.value ?? ""}
                            ariaInvalid={fieldState.invalid}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormDescription>
                          Pick your country and enter your number. Leading zero is fine — we'll normalise to the international format.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="preferredContactMethod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preferred Contact Method</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="email">Email</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            <SelectItem value="phone">Phone Call</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 5 && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
                  data-testid="step-otp"
                >
                  <h2 className="text-xl font-medium border-b pb-2">
                    Verify Your Contact
                  </h2>

                  {!otpRequest ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Choose where to receive your one-time verification code. The code expires in 10 minutes.
                      </p>
                      <RadioGroup
                        value={otpChannel}
                        onValueChange={(v) =>
                          setOtpChannel(v as "email" | "whatsapp")
                        }
                        className="flex flex-col space-y-2"
                      >
                        <label className="flex items-center space-x-3 p-3 rounded border hover:bg-accent/50 cursor-pointer">
                          <RadioGroupItem
                            value="email"
                            data-testid="radio-otp-email"
                          />
                          <MailCheck className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            Email me at{" "}
                            <span className="font-medium">
                              {emailValue || "(not provided)"}
                            </span>
                          </span>
                        </label>
                        {/* WhatsApp OTP option hidden pending Twilio template
                            approval. Backend logic + state remain intact —
                            restore this <label> block to re-enable. */}
                      </RadioGroup>
                      <Button
                        type="button"
                        onClick={requestOtp}
                        disabled={otpRequesting || !emailValue}
                        data-testid="button-send-otp"
                      >
                        {otpRequesting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                            Sending…
                          </>
                        ) : (
                          "Send verification code"
                        )}
                      </Button>
                      {otpError && (
                        <p
                          className="text-sm text-destructive"
                          data-testid="text-otp-error"
                        >
                          {otpError}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        We sent a 6-digit code via{" "}
                        <span className="font-medium">
                          {otpRequest.deliveredVia === "email"
                            ? "email"
                            : "WhatsApp"}
                        </span>
                        . Enter it below to continue.
                      </p>
                      {otpRequest.deliveryNote && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {otpRequest.deliveryNote}
                        </p>
                      )}
                      {otpRequest.devCode && (
                        <div
                          className="text-xs rounded border border-dashed border-amber-400/50 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-300 font-mono"
                          data-testid="text-dev-code"
                        >
                          DEV ONLY — code: {otpRequest.devCode}
                        </div>
                      )}
                      <Input
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) =>
                          setOtpCode(e.target.value.replace(/\D/g, ""))
                        }
                        placeholder="123456"
                        className="text-center text-lg font-mono tracking-widest"
                        data-testid="input-otp-code"
                      />
                      {otpError && (
                        <p
                          className="text-sm text-destructive"
                          data-testid="text-otp-error"
                        >
                          {otpError}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3">
                        <Button
                          type="button"
                          onClick={verifyOtp}
                          disabled={otpVerifying || otpCode.length !== 6}
                          data-testid="button-verify-otp"
                        >
                          {otpVerifying ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />{" "}
                              Verifying…
                            </>
                          ) : (
                            "Verify and continue"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setOtpRequest(null);
                            setOtpCode("");
                            setOtpError(null);
                          }}
                          data-testid="button-resend-otp"
                        >
                          Send a new code
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 6 && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
                  data-testid="step-terms"
                >
                  <h2 className="text-xl font-medium border-b pb-2">
                    Terms & Disclaimer
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Please read each item below. Tap a link to view the full text.
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-2">
                    <li>
                      Read our <LegalLink kind="terms">Terms of Use</LegalLink>.
                    </li>
                    <li>
                      Read our{" "}
                      <LegalLink kind="privacy">Privacy Notice</LegalLink>.
                    </li>
                    <li>
                      Review the{" "}
                      <LegalLink kind="disclaimer">Disclaimer</LegalLink>.
                    </li>
                  </ul>

                  <FormField
                    control={form.control}
                    name="consentAccepted"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/50">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-consent"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            I have read and accept the Terms of Use, Privacy
                            Notice, and Disclaimer.
                          </FormLabel>
                          <FormDescription>
                            Your information is held confidentially and is not
                            shared with any government department.
                          </FormDescription>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Step 7 — branches based on wantsToUploadDocuments. The
                  gate radio is always rendered first; when "yes" the
                  uploader appears below the radio. When "no" the
                  Continue button finalizes immediately. */}
              {step === 7 && createdLead && wantsDocs !== "yes" && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
                  data-testid="step-docs-gate"
                >
                  <h2 className="text-xl font-medium border-b pb-2">
                    Supporting Documents
                  </h2>
                  <FormField
                    control={form.control}
                    name="wantsToUploadDocuments"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>
                          Do you have supporting documents to upload?
                        </FormLabel>
                        <FormDescription>
                          Examples: passport scans, visa permits, medical letters, employment letters, financial statements.
                        </FormDescription>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                            className="flex flex-col space-y-2"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem
                                  value="yes"
                                  data-testid="radio-docs-yes"
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">
                                Yes, I want to upload documents
                              </FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem
                                  value="no"
                                  data-testid="radio-docs-no"
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">
                                No, I will submit without documents
                              </FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 7 && createdLead && wantsDocs === "yes" && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
                  data-testid="step-documents"
                >
                  <h2 className="text-xl font-medium border-b pb-2">
                    Upload Supporting Documents
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Add any documents that may help your case review. You can
                    upload multiple files, remove any that were uploaded by
                    mistake, and continue when you're ready.
                  </p>
                  <DocumentUploader
                    leadId={createdLead.id}
                    sessionStartedAt={sessionStartedAtRef.current}
                    onChange={(docs) => setDocumentsUploaded(docs.length)}
                  />
                  <button
                    type="button"
                    className="text-sm underline text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      form.setValue("wantsToUploadDocuments", "no", {
                        shouldValidate: true,
                      })
                    }
                    data-testid="link-skip-docs"
                  >
                    Actually, I don't have documents to upload — skip
                  </button>
                </div>
              )}

              {onSummaryStep && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center"
                  data-testid="step-summary"
                >
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mx-auto">
                    <ShieldCheck className="h-8 w-8" />
                  </div>
                  <h2 className="text-2xl font-display font-semibold">
                    {personalised.greeting}
                  </h2>
                  <p className="text-base font-medium text-foreground">
                    {personalised.headline}
                  </p>

                  {/*
                    Phase 1 (Q2 = X): the reference number is generated
                    server-side at lead insert (end of Terms step) but is
                    intentionally NOT shown to the user here. It is only
                    revealed on the final Thank-You confirmation page after
                    `finalize` is called, so the user only sees it once at
                    the very end of their journey.
                  */}

                  <div className="text-left space-y-3 text-sm leading-relaxed text-muted-foreground">
                    {personalised.body.map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>

                  <div className="rounded-md border bg-muted/40 p-4 text-left">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Next step
                    </p>
                    <p className="text-sm font-medium mt-1">
                      {personalised.nextStep}
                    </p>
                  </div>
                </div>
              )}

              {/* Footer / nav buttons -------------------------------------- */}
              <div className="flex justify-between pt-6 border-t">
                {step > 1 && step < SUMMARY_STEP ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    data-testid="button-back"
                  >
                    Back
                  </Button>
                ) : (
                  <div></div>
                )}

                {step < 5 && (
                  <Button
                    type="button"
                    onClick={nextStep}
                    data-testid="button-continue"
                  >
                    Continue
                  </Button>
                )}

                {/* Step 5 controls live inside the OTP block above. */}

                {step === 6 && (
                  <Button
                    type="submit"
                    disabled={
                      createLead.isPending ||
                      !form.watch("consentAccepted") ||
                      !verifiedOtpId
                    }
                    data-testid="button-submit-assessment"
                  >
                    {createLead.isPending
                      ? "Saving…"
                      : "Continue"}
                  </Button>
                )}

                {step === 7 &&
                  createdLead &&
                  wantsDocs !== "yes" && (
                    <Button
                      type="button"
                      onClick={finalizeAndShowSummary}
                      disabled={!wantsDocs || finalizing}
                      data-testid="button-skip-docs-continue"
                    >
                      {finalizing ? "Submitting…" : "Submit assessment"}
                    </Button>
                  )}

                {step === 7 && createdLead && wantsDocs === "yes" && (
                  <Button
                    type="button"
                    onClick={finalizeAndShowSummary}
                    disabled={finalizing}
                    data-testid="button-finalize"
                  >
                    {finalizing ? "Submitting…" : "Finish & view summary"}
                  </Button>
                )}

                {onSummaryStep && (
                  <div className="flex gap-3">
                    <Link href="/status">
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="button-check-status"
                      >
                        Check Status
                      </Button>
                    </Link>
                    <Button
                      type="button"
                      onClick={() => setLocation("/")}
                      data-testid="button-return-home"
                    >
                      Return Home
                    </Button>
                  </div>
                )}
              </div>
            </form>
          </Form>
        </Card>
      </div>
    </div>
  );
}
