import { useEffect } from "react";
import { useParams, Link } from "wouter";
import {
  useGetLeadByReference,
  getGetLeadByReferenceQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclaimer } from "@/components/disclaimer";
import { BrandHeader } from "@/components/brand-header";
import { buildPersonalisedNote } from "@/lib/personalisedNote";
import { ReferralConsentCard } from "@/components/referral-consent-card";
import { trackPixelOncePersistent } from "@/lib/metaPixel";

export function ThankYou() {
  const params = useParams();
  const reference = params.reference || "";

  useEffect(() => {
    document.title = "Assessment Recorded | E-Migration Assist";
  }, []);

  const { data: lead, isLoading, isError } = useGetLeadByReference(reference, {
    query: {
      enabled: !!reference,
      queryKey: getGetLeadByReferenceQueryKey(reference),
    },
  });

  // Meta Pixel: the assessment application was submitted & confirmed. Only
  // fire once the reference resolves to a real lead (avoids counting direct /
  // invalid thank-you URL hits). Deduped per reference so a refresh / revisit
  // doesn't double-count. No PII is sent.
  useEffect(() => {
    if (!reference || !lead) return;
    trackPixelOncePersistent(`submitapp_${reference}`, "SubmitApplication", {
      content_name: "Assessment Application",
      content_category: "assessment",
    });
  }, [reference, lead]);

  // The public lookup intentionally strips PII fields, but it does include
  // immigrationSituation (already public) and a few classification hints.
  // We feed those into the same rules-based note generator the assessment
  // final step uses, so the message stays consistent across surfaces.
  const personalised = lead
    ? buildPersonalisedNote({
        fullName: lead.fullName ?? null,
        immigrationSituation: lead.immigrationSituation ?? null,
      })
    : null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8">
        <BrandHeader variant="compact" />
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h1 className="text-3xl font-display font-bold">
            Preliminary Assessment Recorded
          </h1>
          <p className="text-muted-foreground text-lg">
            Your information has been securely saved.
          </p>
        </div>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center bg-accent/30 border-b pb-6">
            <CardDescription className="uppercase tracking-wider font-semibold text-xs mb-2">
              Your Reference Number
            </CardDescription>
            <CardTitle className="text-3xl md:text-4xl font-mono tracking-widest text-primary break-all">
              {reference}
            </CardTitle>
          </CardHeader>

          <CardContent className="pt-6 space-y-6">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : isError ? (
              <div className="p-4 bg-muted text-muted-foreground text-sm rounded-md">
                Detailed status could not be loaded right now. Please save your
                reference number and check back later.
              </div>
            ) : personalised ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 space-y-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Assessment Note
                  </div>
                  <div className="text-base font-medium text-foreground">
                    {personalised.headline}
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
                    {personalised.body.map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/40 p-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Next step
                  </div>
                  <p className="text-sm font-medium mt-1">
                    {personalised.nextStep}
                  </p>
                </div>
              </div>
            ) : null}

            <Disclaimer />
          </CardContent>
          <CardFooter className="flex flex-col gap-4 border-t bg-muted/20 pt-6">
            <p className="text-sm text-center text-muted-foreground max-w-md">
              Save your reference number. You can return anytime to check your
              status.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/status">
                <Button data-testid="button-check-status">Check Status</Button>
              </Link>
              <Link href="/">
                <Button variant="outline">Return Home</Button>
              </Link>
            </div>
          </CardFooter>
        </Card>

        {reference ? (
          <ReferralConsentCard referenceNumber={reference} />
        ) : null}
      </div>
    </div>
  );
}
