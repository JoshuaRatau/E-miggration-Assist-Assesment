import { useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";
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
import { Badge } from "@/components/ui/badge";
import { BrandHeader } from "@/components/brand-header";
import { Disclaimer } from "@/components/disclaimer";
import { ShieldCheck, ArrowRight, Lock } from "lucide-react";

type ReferralPreview = {
  referralId: string;
  status: string;
  matterType: string | null;
  urgency: string | null;
  region: string | null;
  summary: string | null;
  tunnelReady: boolean;
};

async function fetchPreview(referralId: string): Promise<ReferralPreview> {
  const res = await fetch(apiUrl(`/api/referrals/preview/${referralId}`), {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `preview_failed_${res.status}`);
  }
  return res.json();
}

export function ReferralPreview() {
  const params = useParams();
  const referralId = params.referralId || "";

  useEffect(() => {
    document.title = "Your Referral | EMA Leads Funnel";
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["referral", "preview", referralId],
    queryFn: () => fetchPreview(referralId),
    enabled: !!referralId,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-background">
      <BrandHeader />
      <main className="max-w-2xl mx-auto px-4 py-10 md:py-16">
        <Card className="border-border/40">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-2xl font-display">
                We found a vetted firm for you
              </CardTitle>
            </div>
            <CardDescription className="text-base">
              Based on your assessment, a partner immigration firm can take on
              your matter. Here is a summary of what will be shared — none of
              your personal contact details are visible on this page.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : isError || !data ? (
              <div
                className="rounded-lg border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground"
                data-testid="text-referral-not-found"
              >
                We couldn't find this referral. The link may have expired or is
                no longer valid. Please return to your confirmation page.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Matter type
                    </div>
                    <div
                      className="mt-1 font-medium"
                      data-testid="text-preview-matter"
                    >
                      {data.matterType || "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Urgency
                    </div>
                    <div
                      className="mt-1 font-medium capitalize"
                      data-testid="text-preview-urgency"
                    >
                      {data.urgency || "—"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Region
                    </div>
                    <div
                      className="mt-1 font-medium"
                      data-testid="text-preview-region"
                    >
                      {data.region || "—"}
                    </div>
                  </div>
                </div>

                {data.summary ? (
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-4 text-sm">
                    {data.summary}
                  </div>
                ) : null}

                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    Your full details are only released to the firm inside EMA
                    after a conflict check passes. This page never exposes your
                    contact information.
                  </span>
                </div>
              </>
            )}
          </CardContent>

          {data ? (
            <CardFooter className="flex flex-col items-stretch gap-3">
              {data.tunnelReady ? (
                <a
                  href={apiUrl(`/api/referral-gate/redirect/${referralId}`)}
                  data-testid="link-continue-to-ema"
                >
                  <Button className="w-full" size="lg">
                    Continue to EMA
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                </a>
              ) : (
                <Badge variant="secondary" className="justify-center py-2">
                  Preparing your secure hand-off…
                </Badge>
              )}
            </CardFooter>
          ) : null}
        </Card>

        <div className="mt-8">
          <Disclaimer />
        </div>
      </main>
    </div>
  );
}

export default ReferralPreview;
