import { useEffect, useState } from "react";
import {
  getGetPublicStatusQueryKey,
  useGetPublicStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, FileText, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Disclaimer } from "@/components/disclaimer";
import { BrandHeader } from "@/components/brand-header";
import { trackEvent } from "@/lib/analytics";

export function Status() {
  useEffect(() => {
    document.title = "Check Status | E-Migration Assist";
  }, []);

  const [searchRef, setSearchRef] = useState("");
  const [activeRef, setActiveRef] = useState("");

  // Pre-fill + auto-look-up from a ?reference= query param (used when a
  // duplicate assessment submission redirects the user here).
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("reference");
    if (param) {
      const trimmed = param.trim().toUpperCase();
      setSearchRef(trimmed);
      setActiveRef(trimmed);
    }
  }, []);

  const { data, isLoading, isError, error } = useGetPublicStatus(activeRef, {
    query: {
      enabled: !!activeRef,
      queryKey: getGetPublicStatusQueryKey(activeRef),
      retry: false,
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchRef.trim().toUpperCase();
    if (trimmed) {
      trackEvent("reference_lookup_started", {
        payload: {
          route:
            new URLSearchParams(window.location.search).get("route") ??
            undefined,
          path: window.location.pathname,
          timestamp: new Date().toISOString(),
        },
      });
      setActiveRef(trimmed);
    }
  };

  const status = data as
    | {
        referenceNumber: string;
        publicLabel: string;
        createdAt: string;
        documentsUploaded: boolean;
      }
    | undefined;

  // Surface a 429 differently from a 404 so the user knows to wait.
  const errorStatus =
    (error as { status?: number; response?: { status?: number } } | undefined)
      ?.status ??
    (error as { response?: { status?: number } } | undefined)?.response
      ?.status;
  const isRateLimited = errorStatus === 429;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center py-12 px-6">
      <div className="w-full max-w-lg space-y-8">
        <BrandHeader variant="compact" />
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-display font-bold">Check Your Status</h1>
          <p className="text-muted-foreground">
            Enter your reference number to view your preliminary assessment.
          </p>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="flex gap-3">
              <Input
                placeholder="e.g. EMA-..."
                value={searchRef}
                onChange={(e) => setSearchRef(e.target.value)}
                className="font-mono uppercase"
                data-testid="input-reference"
                aria-label="Reference number"
              />
              <Button type="submit" data-testid="button-check">
                Check
              </Button>
            </form>
          </CardContent>
        </Card>

        {activeRef && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {isLoading ? (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-20 w-full mt-4" />
                </CardContent>
              </Card>
            ) : isError ? (
              <Card
                className="border-border/40 bg-muted/40"
                data-testid="status-error"
              >
                <CardContent className="pt-6 text-center text-muted-foreground">
                  {isRateLimited ? (
                    <>
                      <p className="font-medium text-foreground">
                        Too many lookups
                      </p>
                      <p className="text-sm mt-1">
                        Please wait a minute and try again.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-foreground">
                        Reference not found
                      </p>
                      <p className="text-sm mt-1">
                        Please check the number and try again.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : status ? (
              <Card
                className="border-border/50 shadow-md"
                data-testid="status-card"
              >
                <CardHeader className="border-b bg-accent/20">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <CardTitle className="text-xl">
                        Assessment Details
                      </CardTitle>
                      <CardDescription
                        className="font-mono mt-1 break-all"
                        data-testid="text-reference"
                      >
                        {status.referenceNumber}
                      </CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-background whitespace-nowrap"
                    >
                      Recorded{" "}
                      {format(new Date(status.createdAt), "MMM d, yyyy")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Case Status
                    </div>
                    <div
                      className="text-base font-medium text-foreground"
                      data-testid="text-public-label"
                    >
                      {status.publicLabel}
                    </div>
                  </div>

                  <div
                    className="flex items-start gap-3 rounded-md border bg-muted/30 p-3"
                    data-testid="text-documents-indicator"
                  >
                    {status.documentsUploaded ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium">
                            Supporting documents received
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Files you uploaded are linked to this reference.
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium">No documents uploaded yet</p>
                          <p className="text-xs text-muted-foreground">
                            You can attach supporting documents from the
                            assessment flow when you return.
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="bg-muted/40 p-4 rounded-lg text-sm text-foreground/80 leading-relaxed border border-border/50">
                    This is your current assessment status. You may be contacted
                    when the full platform becomes available.
                  </div>

                  <Disclaimer variant="compact" />
                </CardContent>
              </Card>
            ) : null}

            {!isLoading && !isError && !status && (
              <Card className="border-border/40 bg-muted/40">
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2" />
                  <p className="text-sm">No status available.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="text-center pt-8">
          <Button variant="link" asChild>
            <a href="/">Back to Home</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
