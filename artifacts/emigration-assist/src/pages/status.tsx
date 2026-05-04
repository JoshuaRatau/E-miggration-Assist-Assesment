import { useEffect, useState } from "react";
import { getGetLeadByReferenceQueryKey, useGetLeadByReference } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export function Status() {
  useEffect(() => {
    document.title = "Check Status | E-Migration Assist";
  }, []);

  const [searchRef, setSearchRef] = useState("");
  const [activeRef, setActiveRef] = useState("");

  const { data: lead, isLoading, isError } = useGetLeadByReference(activeRef, {
    query: {
      enabled: !!activeRef,
      queryKey: getGetLeadByReferenceQueryKey(activeRef),
      retry: false
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchRef.trim()) {
      setActiveRef(searchRef.trim().toUpperCase());
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center py-12 px-6">
      <div className="w-full max-w-lg space-y-8">
        
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-display font-bold">Check Your Status</h1>
          <p className="text-muted-foreground">Enter your reference number to view your assessment status.</p>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="flex gap-3">
              <Input 
                placeholder="e.g. REF-123456" 
                value={searchRef}
                onChange={(e) => setSearchRef(e.target.value)}
                className="font-mono uppercase"
              />
              <Button type="submit">Check</Button>
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
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="pt-6 text-center text-destructive">
                  <p className="font-medium">Reference not found</p>
                  <p className="text-sm mt-1">Please check the number and try again.</p>
                </CardContent>
              </Card>
            ) : lead ? (
              <Card className="border-border/50 shadow-md">
                <CardHeader className="border-b bg-accent/20">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl">Assessment Details</CardTitle>
                      <CardDescription className="font-mono mt-1">{lead.referenceNumber}</CardDescription>
                    </div>
                    <Badge variant="outline" className="bg-background">
                      Submitted {format(new Date(lead.createdAt), 'MMM d, yyyy')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Status</span>
                      <p className="font-medium">Waitlisted</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Category</span>
                      <p className="font-medium capitalize">{lead.leadCategory?.replace('_', ' ') || 'Pending'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Nationality</span>
                      <p className="font-medium">{lead.nationality}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Current Situation</span>
                      <p className="font-medium capitalize">{lead.immigrationSituation?.replace('_', ' ')}</p>
                    </div>
                  </div>

                  <div className="bg-primary/5 p-4 rounded-lg text-sm text-foreground/80 leading-relaxed border border-primary/10">
                    Your assessment has been categorized. We will contact you via {lead.preferredContactMethod || 'your preferred method'} when our specialists are ready to assist with your specific case type.
                  </div>

                </CardContent>
              </Card>
            ) : null}
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
