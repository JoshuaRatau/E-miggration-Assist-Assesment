import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";
import { AdminLayout } from "@/components/admin-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Share2 } from "lucide-react";

type ReferralRow = {
  referralId: string;
  assignmentId: string | null;
  status: string;
  matterType: string | null;
  urgency: string | null;
  region: string | null;
  summary: string | null;
  consentToShare: boolean;
  emaFirmId: string | null;
  emaCaseId: string | null;
  failedReason: string | null;
  createdAt: string;
  pushedAt: string | null;
  convertedToEmaCaseAt: string | null;
};

type AuditRow = {
  id: string;
  referralId: string;
  stage: string;
  detail: unknown;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  offered: "bg-slate-500/15 text-slate-300",
  preview_viewed: "bg-blue-500/15 text-blue-300",
  accepted: "bg-indigo-500/15 text-indigo-300",
  pushed: "bg-amber-500/15 text-amber-300",
  converted: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
};

async function fetchReferrals(): Promise<{ referrals: ReferralRow[] }> {
  const res = await fetch(apiUrl("/api/admin/referrals"), {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`referrals_failed_${res.status}`);
  return res.json();
}

async function fetchReferralDetail(
  referralId: string,
): Promise<{ referral: ReferralRow; audit: AuditRow[] }> {
  const res = await fetch(apiUrl(`/api/admin/referrals/${referralId}`), {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`referral_detail_failed_${res.status}`);
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={STATUS_COLORS[status] || "bg-muted text-muted-foreground"}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function AdminReferrals() {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Referral Tunnel | EMA Leads Funnel";
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "referrals"],
    queryFn: fetchReferrals,
    refetchInterval: 15000,
  });

  const detail = useQuery({
    queryKey: ["admin", "referral", selected],
    queryFn: () => fetchReferralDetail(selected as string),
    enabled: !!selected,
  });

  const referrals = data?.referrals ?? [];

  return (
    <AdminLayout title="Referral Tunnel">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 py-6">
        <Card className="lg:col-span-2 border-border/40">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-xl font-display">
                  Partner referrals
                </CardTitle>
                <CardDescription>
                  Leads offered to vetted partner firms via the secure tunnel.
                  No applicant contact details are stored on referral records.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : isError ? (
              <div className="text-sm text-red-400">
                Failed to load referrals.
              </div>
            ) : referrals.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No referrals yet. Referrals appear here once an applicant
                consents to being matched with a partner firm.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Matter</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Consent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {referrals.map((r) => (
                      <TableRow
                        key={r.referralId}
                        className="cursor-pointer"
                        onClick={() => setSelected(r.referralId)}
                        data-testid={`row-referral-${r.referralId}`}
                      >
                        <TableCell className="font-mono text-xs">
                          {r.referralId}
                        </TableCell>
                        <TableCell>{r.matterType || "—"}</TableCell>
                        <TableCell>{r.region || "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell>
                          {r.consentToShare ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/15 text-emerald-300"
                            >
                              yes
                            </Badge>
                          ) : (
                            <Badge variant="outline">no</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg font-display">
              Referral detail
            </CardTitle>
            <CardDescription>
              {selected
                ? "Timeline and current tunnel state."
                : "Select a referral to see its audit trail."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? (
              <div className="text-sm text-muted-foreground">
                Nothing selected.
              </div>
            ) : detail.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : detail.isError || !detail.data ? (
              <div className="text-sm text-red-400">Failed to load detail.</div>
            ) : (
              <>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <StatusBadge status={detail.data.referral.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Assignment</span>
                    <span className="font-mono text-xs">
                      {detail.data.referral.assignmentId || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">EMA case</span>
                    <span className="font-mono text-xs">
                      {detail.data.referral.emaCaseId || "—"}
                    </span>
                  </div>
                  {detail.data.referral.failedReason ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Failure</span>
                      <span className="text-red-400 text-xs">
                        {detail.data.referral.failedReason}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Timeline
                  </div>
                  <ol className="space-y-2">
                    {detail.data.audit.map((a) => (
                      <li
                        key={a.id}
                        className="text-xs border-l-2 border-border/40 pl-3"
                      >
                        <div className="font-medium">
                          {a.stage.replace(/_/g, " ")}
                        </div>
                        <div className="text-muted-foreground">
                          {new Date(a.createdAt).toLocaleString()}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

export default AdminReferrals;
