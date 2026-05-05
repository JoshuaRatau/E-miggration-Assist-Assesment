import { useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetLeadByReference, getGetLeadByReferenceQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclaimer } from "@/components/disclaimer";

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

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8">

        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h1 className="text-3xl font-display font-bold">Preliminary Assessment Recorded</h1>
          <p className="text-muted-foreground text-lg">Your information has been securely saved.</p>
        </div>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center bg-accent/30 border-b pb-6">
            <CardDescription className="uppercase tracking-wider font-semibold text-xs mb-2">Your Reference Number</CardDescription>
            <CardTitle className="text-3xl md:text-4xl font-mono tracking-widest text-primary break-all">
              {reference}
            </CardTitle>
          </CardHeader>

          <CardContent className="pt-6 space-y-6">
            <p className="text-sm leading-relaxed">
              Your preliminary assessment has been successfully recorded. This system provides a structured, early-stage understanding of your situation based on the information you submitted.
            </p>
            <p className="text-sm leading-relaxed">
              We are currently finalising the full E-Migration Assist platform. A notification follows once more detailed assessment capabilities become available.
            </p>

            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : isError ? (
              <div className="p-4 bg-muted text-muted-foreground text-sm rounded-md">
                Detailed status could not be loaded right now. Please save your reference number and check back later.
              </div>
            ) : lead?.leadCategory ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Assessment Note
                </div>
                <div className="text-base font-medium text-foreground">
                  {lead.leadCategory}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                  Based on the information provided, your situation may fall into a category that requires further review. This is a preliminary system-generated assessment and does not represent a final decision.
                </p>
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
      </div>
    </div>
  );
}
