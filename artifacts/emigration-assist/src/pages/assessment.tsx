import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateLead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Disclaimer } from "@/components/disclaimer";
import { trackEvent } from "@/lib/analytics";
import { DocumentUploader } from "@/components/DocumentUploader";

const assessmentSchema = z.object({
  // Step 1
  nationality: z.string().min(2, "Nationality is required"),
  countryOfResidence: z.string().optional(),
  currentlyInSouthAfrica: z.boolean().default(false),

  // Step 2
  immigrationSituation: z.enum([
    "valid",
    "expired",
    "overstay",
    "undesirable",
    "prohibited",
    "unknown",
  ]),
  passportStatus: z.enum(["valid", "expired", "lost", "none"]).optional(),

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
  whatsapp: z.string().optional(),
  preferredContactMethod: z.enum(["email", "whatsapp", "phone"]).default("email"),
  consentAccepted: z.boolean().refine((val) => val === true, "You must accept the terms"),
});

type AssessmentFormValues = z.infer<typeof assessmentSchema>;

export function Assessment() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const [createdLead, setCreatedLead] = useState<{
    id: string;
    referenceNumber: string;
  } | null>(null);

  const createLead = useCreateLead();

  useEffect(() => {
    document.title = "Immigration Assessment | E-Migration Assist";
    trackEvent("assessment_started");
  }, []);

  const form = useForm<AssessmentFormValues>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: {
      currentlyInSouthAfrica: false,
      immigrationSituation: "valid",
      passportStatus: "valid",
      preferredContactMethod: "email",
      consentAccepted: false,
    },
    mode: "onTouched",
  });

  const situation = form.watch("immigrationSituation");

  const nextStep = async () => {
    let fieldsToValidate: any[] = [];

    if (step === 1) fieldsToValidate = ["nationality", "countryOfResidence", "currentlyInSouthAfrica"];
    if (step === 2) fieldsToValidate = ["immigrationSituation", "passportStatus"];
    if (step === 3) fieldsToValidate = ["visaExpiryDate", "exitDate", "borderDocumentIssued", "overstayReason", "overstayReasonNotes", "previousOverstay", "hasSupportingDocuments", "visaHistory"];

    const isValid = await form.trigger(fieldsToValidate as any);
    if (isValid) {
      setStep((s) => Math.min(s + 1, totalSteps));
      window.scrollTo(0, 0);
    }
  };

  const prevStep = () => {
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo(0, 0);
  };

  const onSubmit = (data: AssessmentFormValues) => {
    const { overstayReasonNotes, ...rest } = data;
    // Keep the canonical enum value in overstayReason so server-side classification
    // can match exactly. Free-text notes are appended to visaHistory for context.
    const visaHistoryWithNotes = overstayReasonNotes
      ? [rest.visaHistory, `Overstay context: ${overstayReasonNotes}`]
          .filter(Boolean)
          .join("\n\n")
      : rest.visaHistory;

    const submitData = {
      ...rest,
      visaHistory: visaHistoryWithNotes,
    };

    createLead.mutate(
      { data: submitData },
      {
        onSuccess: (result) => {
          trackEvent("assessment_completed", {
            referenceNumber: result.referenceNumber,
          });
          if (data.hasSupportingDocuments && data.hasSupportingDocuments !== "no") {
            trackEvent("document_upload", {
              referenceNumber: result.referenceNumber,
              payload: { hasSupportingDocuments: data.hasSupportingDocuments },
            });
          }
          setCreatedLead({
            id: result.id,
            referenceNumber: result.referenceNumber,
          });
          setStep(5);
          window.scrollTo(0, 0);
        },
        onError: () => {
          toast({
            title: "Submission could not be completed",
            description: "There was an issue saving your information. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-muted/30 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-display font-semibold text-center">Your Preliminary Assessment</h1>
          <Progress value={(step / totalSteps) * 100} className="h-2" />
          <p className="text-center text-sm text-muted-foreground">Step {step} of {totalSteps}</p>
        </div>

        <Card className="p-6 md:p-8 shadow-lg border-border/40">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

              {step === 1 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">Basic Information</h2>

                  <FormField
                    control={form.control}
                    name="nationality"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nationality</FormLabel>
                        <FormControl>
                          <Input placeholder="E.g. Zimbabwean, British..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="countryOfResidence"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Country of Residence</FormLabel>
                        <FormControl>
                          <Input placeholder="Where do you currently live?" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="currentlyInSouthAfrica"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>I am currently inside South Africa</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">Current Situation</h2>

                  <FormField
                    control={form.control}
                    name="immigrationSituation"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>Which best describes your situation?</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col space-y-2"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="valid" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">I currently hold a valid visa</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="expired" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">My visa is expiring or has expired</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="overstay" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">I have remained beyond my visa period (overstay)</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="undesirable" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">I have been declared undesirable</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="prohibited" />
                              </FormControl>
                                <FormLabel className="font-normal cursor-pointer w-full">I may have been listed as a prohibited person</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 rounded border hover:bg-accent/50 transition-colors">
                              <FormControl>
                                <RadioGroupItem value="unknown" />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">Unsure / prefer further review</FormLabel>
                            </FormItem>
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
                        <FormLabel>Passport Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select passport status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="valid">Valid passport</SelectItem>
                            <SelectItem value="expired">Expired passport</SelectItem>
                            <SelectItem value="lost">Lost or stolen passport</SelectItem>
                            <SelectItem value="none">No passport</SelectItem>
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
                  <h2 className="text-xl font-medium border-b pb-2">Additional Context</h2>

                  {(situation === "expired" || situation === "overstay") && (
                    <FormField
                      control={form.control}
                      name="visaExpiryDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Visa Expiry Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} value={field.value || ""} />
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
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                        <FormDescription>Any previous visas held or applications submitted.</FormDescription>
                        <FormControl>
                          <Textarea placeholder="e.g. Held a study visa from 2018 to 2021..." className="resize-none" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">Contact Details</h2>
                  <p className="text-sm text-muted-foreground">
                    Your reference number will be sent here. We may also notify you when fuller assessment capabilities become available.
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
                          <Input type="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="whatsapp"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>WhatsApp Number (optional)</FormLabel>
                        <FormControl>
                          <Input type="tel" placeholder="+27..." {...field} />
                        </FormControl>
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
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

                  <Disclaimer />

                  <FormField
                    control={form.control}
                    name="consentAccepted"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/50">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            I agree to receive updates about my assessment and platform availability.
                          </FormLabel>
                          <FormDescription>
                            Your information is held confidentially and is not shared with any government department.
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 5 && createdLead && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-medium border-b pb-2">
                    Upload Supporting Documents (Optional)
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Uploading documents may help improve your future assessment
                    when the full system is available.
                  </p>
                  <div className="rounded-md bg-muted/40 border p-3 text-sm">
                    <span className="text-muted-foreground">Reference: </span>
                    <code className="font-mono">
                      {createdLead.referenceNumber}
                    </code>
                  </div>
                  <DocumentUploader leadId={createdLead.id} />
                </div>
              )}

              <div className="flex justify-between pt-6 border-t">
                {step > 1 && step < 5 ? (
                  <Button type="button" variant="outline" onClick={prevStep}>
                    Back
                  </Button>
                ) : (
                  <div></div>
                )}

                {step < 4 && (
                  <Button type="button" onClick={nextStep}>
                    Continue
                  </Button>
                )}
                {step === 4 && (
                  <Button type="submit" disabled={createLead.isPending}>
                    {createLead.isPending ? "Submitting..." : "Submit Assessment"}
                  </Button>
                )}
                {step === 5 && createdLead && (
                  <Button
                    type="button"
                    onClick={() =>
                      setLocation(`/thank-you/${createdLead.referenceNumber}`)
                    }
                    data-testid="button-continue-to-summary"
                  >
                    Continue to summary
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </Card>
      </div>
    </div>
  );
}
