import { useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetLeadByReference, getGetLeadByReferenceQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export function ThankYou() {
  const params = useParams();
  const reference = params.reference || "";
  
  useEffect(() => {
    document.title = "Assessment Received | E-Migration Assist";
  }, []);

  const { data: lead, isLoading, isError } = useGetLeadByReference(reference, {
    query: {
      enabled: !!reference,
      queryKey: getGetLeadByReferenceQueryKey(reference)
    }
  });

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8">
        
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h1 className="text-3xl font-display font-bold">Assessment Received</h1>
          <p className="text-muted-foreground text-lg">Your information is secure.</p>
        </div>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center bg-accent/30 border-b pb-6">
            <CardDescription className="uppercase tracking-wider font-semibold text-xs mb-2">Your Reference Number</CardDescription>
            <CardTitle className="text-4xl font-mono tracking-widest text-primary">{reference}</CardTitle>
          </CardHeader>
          
          <CardContent className="pt-6 space-y-6">
            <p className="text-center">
              Please save this reference number. You can use it to check your status at any time.
            </p>

            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : isError ? (
              <div className="p-4 bg-destructive/10 text-destructive text-sm rounded-md">
                Could not load detailed status for this reference.
              </div>
            ) : lead ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <span className="font-medium">Priority Score</span>
                  <Badge variant={lead.leadScore && lead.leadScore > 60 ? "default" : "secondary"}>
                    {lead.leadScore || "Pending"} / 100
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <span className="font-medium">Category</span>
                  <span className="text-sm font-medium capitalize">
                    {lead.leadCategory ? lead.leadCategory.replace('_', ' ') : "Reviewing"}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-5">
              <h3 className="font-semibold text-primary mb-2">What happens next?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                You are on our priority waitlist. Our immigration specialists are currently reviewing assessments. 
                We will contact you via your preferred method when we launch full services to discuss your specific pathway.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-center border-t bg-muted/20 pt-6">
            <Link href="/">
              <Button variant="outline">Return Home</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
