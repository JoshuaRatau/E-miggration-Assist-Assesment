import { useEffect } from "react";
import { Link } from "wouter";
import { useGetStatsSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
            A calm, clear, and confidential pre-launch assessment. Get clarity on your visa situation, overstay status, and next steps in just a few minutes.
          </p>
        </header>

        <div className="flex justify-center">
          <Link href="/assessment">
            <Button size="lg" className="h-14 px-8 text-lg rounded-xl">
              Start Free Assessment
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
                A secure, non-judgmental questionnaire to help understand your current immigration standing in South Africa.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">Who it's for</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                Anyone facing visa challenges, overstays, lost documents, or seeking long-term residency options.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="text-lg">What happens next</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                You'll receive a secure reference number and join our pre-launch waiting list for expert immigration guidance.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center pt-8">
          <h3 className="text-lg font-medium mb-6">Trusted by hundreds of individuals</h3>
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
                <span className="text-sm text-muted-foreground mt-1">Assessments</span>
              </div>
              {stats.byCategory?.slice(0, 3).map((cat) => (
                <div key={cat.category} className="flex flex-col items-center bg-accent/50 px-6 py-4 rounded-xl">
                  <span className="text-3xl font-bold text-primary">{cat.count}</span>
                  <span className="text-sm text-muted-foreground mt-1 capitalize">{cat.category.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        
        <footer className="text-center pt-16 text-sm text-muted-foreground">
          <p>Strictly confidential. No data is shared with government agencies without explicit consent.</p>
          <div className="mt-4">
            <Link href="/status" className="underline hover:text-primary transition-colors">
              Already have a reference number? Check status here.
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
