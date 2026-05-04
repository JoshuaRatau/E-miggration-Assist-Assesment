import { useEffect } from "react";
import { useListLeads } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function Admin() {
  useEffect(() => {
    document.title = "Admin Overview | E-Migration Assist";
  }, []);

  const { data: leads, isLoading } = useListLeads({ limit: 50 });

  return (
    <div className="min-h-screen bg-muted/20 p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-display font-bold">Admin Overview</h1>
          <p className="text-muted-foreground">
            Pre-launch lead monitoring tool. Internal use only — categories and scores shown here are internal classifications and are not displayed to users.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Recent Assessments</CardTitle>
            <CardDescription>Internal classification, score and public-facing label per submission.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : !leads || leads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
                No assessments recorded yet.
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Nationality</TableHead>
                      <TableHead>Situation</TableHead>
                      <TableHead>Internal Category</TableHead>
                      <TableHead>Public Label</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-mono text-xs font-medium">{lead.referenceNumber}</TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {format(new Date(lead.createdAt), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell>{lead.nationality}</TableCell>
                        <TableCell className="capitalize">{lead.immigrationSituation?.replace(/_/g, " ")}</TableCell>
                        <TableCell>
                          <code className="text-xs font-mono text-muted-foreground">
                            {lead.internalClassification || "—"}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="whitespace-nowrap">
                            {lead.leadCategory || "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              lead.leadScore && lead.leadScore >= 80
                                ? "destructive"
                                : lead.leadScore && lead.leadScore >= 60
                                ? "default"
                                : "secondary"
                            }
                          >
                            {lead.leadScore ?? 0}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
