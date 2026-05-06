import { useEffect, useMemo, useState } from "react";
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

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const assessmentSchema = z.object({
  // Step 1
  nationality: z.string().min(2, "Please select your nationality"),
  countryOfResidence: z.string().optional(),
  // Stored as boolean: true = inside SA, false = outside SA. The radio
  // forces an explicit choice (no implicit "false" default).
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
  // "unsure" added for V2 ("I am not sure") alongside the legacy enum.
  passportStatus: z
    .enum(["valid", "expired", "unsure", "lost", "none"])
    .optional(),

  // Step 3 (Conditional)
  visaExpiryDate: z.string().optional(),
  exitDate: z.string().optional(),
  borderDocumentIssued: z.string().optional(),
  overstayReason: z
    .enum(["medical", "accident", "family_emergency", "admin_delay", "other"])
    .optional(),
  overstayReasonNotes: z.string().optional(),
  previousOverstay: z.enum(["yes", "no"]).optional(),
  hasSupportingDocuments: z.enum(["yes", "some", "no"]).optional(),
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

  // Step 6
  consentAccepted: z
    .boolean()
    .refine((val) => val === true, "You must accept the terms"),
});

type AssessmentFormValues = z.infer<typeof assessmentSchema>;

interface OtpRequestState {
  otpId: string;
  deliveredVia: "email" | "whatsapp";
  deliveryNote: string | null;
  expiresAt: string;
  devCode?: string;
}

const TOTAL_STEPS = 8;

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

  const [nationalityIso, setNationalityIso] = useState<string | undefined>();
  const [residenceIso, setResidenceIso] = useState<string | undefined>();

  // When the user switches to "inside SA", default residence to South Africa
  // unless they have already chosen something else.
  useEffect(() => {
    if (insideSA === "inside") {
      const za = findByIso("ZA");
      if (za && !form.getValues("countryOfResidence")) {
        setResidenceIso("ZA");
        form.setValue("countryOfResidence", za.name, { shouldValidate: true });
      }
    }
  }, [insideSA, form]);

  // When the contact step renders, seed the OTP channel from the user's
  // preferred contact method (email/whatsapp). "phone" falls back to email.
  useEffect(() => {
    if (step === 5 && !otpRequest) {
      setOtpChannel(preferred === "whatsapp" ? "whatsapp" : "email");
    }
  }, [step, preferred, otpRequest]);

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
    if (step === 3)
      fieldsToValidate = [
        "visaExpiryDate",
        "exitDate",
        "borderDocumentIssued",
        "overstayReason",
        "overstayReasonNotes",
        "previousOverstay",
        "hasSupportingDocuments",
        "visaHistory",
      ];
    if (step === 4)
      fieldsToValidate = ["fullName", "email", "whatsapp", "preferredContactMethod"];

    const isValid = await form.trigger(fieldsToValidate as any);
    if (!isValid) return;

    if (step === 4) {
      // Don't auto-advance past the contact step until validation passes.
      // OTP is requested explicitly on step 5.
      setStep(5);
    } else {
      setStep((s) => Math.min(s + 1, TOTAL_STEPS));
    }
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

  // Lead creation (called when leaving the T&C step) ------------------------
  const submitLead = (data: AssessmentFormValues) => {
    // Hard-lock against double-submit: once the lead exists for this
    // session, the only valid forward move is documents → summary. A
    // user navigating Back into step 6 and re-clicking submit must not
    // create a second row (server dedupes by email but the client UX
    // would be confusing).
    if (createdLead) {
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
          setStep(7);
          window.scrollTo(0, 0);
        },
        onError: (err: any) => {
          const msg =
            err?.response?.data?.error ??
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

  // Personalised note for the final step.
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
      hasSupportingDocuments: v.hasSupportingDocuments,
      documentsUploaded,
    };
    return buildPersonalisedNote(input);
  }, [createdLead, documentsUploaded, step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <BrandHeader variant="compact" />
        <div className="space-y-4">
          <h1 className="text-3xl font-display font-semibold text-center">
            Your Preliminary Assessment
          </h1>
          <Progress value={(step / TOTAL_STEPS) * 100} className="h-2" />
          <p className="text-center text-sm text-muted-foreground">
            Step {step} of {TOTAL_STEPS}
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
                          />
                        </FormControl>
                        {insideSA === "inside" && (
                          <FormDescription>
                            Defaulted to South Africa — change it if you live elsewhere.
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
                          Do you have a valid passport with at least 6 months remaining?
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
                    name="hasSupportingDocuments"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Do you have supporting documents?</FormLabel>
                        <FormDescription>
                          For example: medical records, proof of incident, employer letters, family-tie documents.
                        </FormDescription>
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
                            <SelectItem value="yes">Yes, I have full supporting documents</SelectItem>
                            <SelectItem value="some">I have some supporting documents</SelectItem>
                            <SelectItem value="no">No supporting documents at this time</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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
                        <label
                          className={`flex items-center space-x-3 p-3 rounded border cursor-pointer ${
                            !whatsappValue
                              ? "opacity-50 cursor-not-allowed"
                              : "hover:bg-accent/50"
                          }`}
                        >
                          <RadioGroupItem
                            value="whatsapp"
                            disabled={!whatsappValue}
                            data-testid="radio-otp-whatsapp"
                          />
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {whatsappValue
                              ? `WhatsApp me at ${whatsappValue}`
                              : "WhatsApp (add a number on the previous step to use this option)"}
                          </span>
                        </label>
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

              {step === 7 && createdLead && (
                <div
                  className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
                  data-testid="step-documents"
                >
                  <h2 className="text-xl font-medium border-b pb-2">
                    Upload Supporting Documents (Optional)
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Add any documents that may help your case review. You can
                    upload multiple files, remove any that were uploaded by
                    mistake, and continue when you're ready.
                  </p>
                  <DocumentUploader
                    leadId={createdLead.id}
                    onChange={(docs) => setDocumentsUploaded(docs.length)}
                  />
                </div>
              )}

              {step === 8 && createdLead && (
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

                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-left">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Your Reference Number
                    </p>
                    <p
                      className="text-2xl font-mono tracking-widest text-primary mt-1 break-all"
                      data-testid="text-reference-number"
                    >
                      {createdLead.referenceNumber}
                    </p>
                  </div>

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
                {/* Back is shown on every step except step 1 and step 8.
                    On step 5 (OTP) Back is allowed to fix contact details. */}
                {step > 1 && step < 8 ? (
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
                      : "Continue to documents"}
                  </Button>
                )}

                {step === 7 && createdLead && (
                  <Button
                    type="button"
                    onClick={() => {
                      setStep(8);
                      window.scrollTo(0, 0);
                    }}
                    data-testid="button-finalize"
                  >
                    Finish & view summary
                  </Button>
                )}

                {step === 8 && createdLead && (
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
