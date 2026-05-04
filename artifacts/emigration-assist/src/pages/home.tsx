import { useEffect } from "react";
import { Link } from "wouter";
import { useGetStatsSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclaimer } from "@/components/disclaimer";

export function Home() {
  useEffect(() => {
    document.title = "Check your South African immigration status | E-Migration Assist";
  }, []);

  const { data: stats, isLoading } = useGetStatsSummary();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 lg:p-12">
      <div className="w-full max-w-4xl mx-auto space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-4xl lg:text-6xl font-display font-bold text-foreground tracking-tight">
            Check your South African immigration status.
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            A calm, structured pre-launch questionnaire that helps build an early-stage understanding of your situation. This is a preliminary system-generated assessment and does not represent a final decision.
          </p>
        </header>

        <div className="flex justify-center">
          <Link href="/assessment">
            <Button size="lg" className="h-14 px-8 text-lg rounded-xl">
              Start Preliminary Assessment
            </Button>
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 pt-12 border-t">
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">What this is</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                A structured, confidential questionnaire that records your information and produces a preliminary, system-generated assessment.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Who it's for</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                Anyone navigating visa expiry, overstay context, lost documents, or other situations that require structured review.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">What happens next</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                A secure reference number is issued to you. A notification follows once more detailed assessment capabilities become available.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center pt-8">
          <h3 className="text-lg font-medium mb-6">Pre-launch activity</h3>
          {isLoading ? (
            <div className="flex flex-wrap justify-center gap-4">
              <Skeleton className="h-24 w-32 rounded-xl" />
              <Skeleton className="h-24 w-32 rounded-xl" />
              <Skeleton className="h-24 w-32 rounded-xl" />
            </div>
          ) : stats ? (
            <div className="flex flex-wrap justify-center gap-6">
              <div className="flex flex-col items-center bg-accent/50 px-6 py-4 rounded-xl">
                <span className="text-3xl font-bold text-primary">{stats.totalAssessments}</span>
                <span className="text-sm text-muted-foreground mt-1">Assessments recorded</span>
              </div>
              <div className="flex flex-col items-center bg-accent/50 px-6 py-4 rounded-xl">
                <span className="text-3xl font-bold text-primary">{stats.last24Hours}</span>
                <span className="text-sm text-muted-foreground mt-1">In the last 24 hours</span>
              </div>
              <div className="flex flex-col items-center bg-accent/50 px-6 py-4 rounded-xl">
                <span className="text-3xl font-bold text-primary">{stats.byCategory?.length ?? 0}</span>
                <span className="text-sm text-muted-foreground mt-1">Distinct review categories</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="pt-8">
          <Disclaimer />
        </div>

        <footer className="text-center pt-8 text-sm text-muted-foreground space-y-3">
          <p>Strictly confidential. Information is not shared with government agencies without explicit consent.</p>
          <div>
            <Link href="/status" className="underline hover:text-primary transition-colors">
              Already have a reference number? Check your status here.
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
