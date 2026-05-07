import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BrandHeader } from "@/components/brand-header";
import { AdminUserMenu } from "@/components/admin-user-menu";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Send, Mail, MessageSquare } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Campaign {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  status: "draft" | "sending" | "completed" | "cancelled";
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsSkipped: number;
  recipientsUnsubscribed: number;
  createdAt: string;
  sentAt: string | null;
}

const STATUS_TONE: Record<Campaign["status"], string> = {
  draft: "border-slate-300/40 bg-slate-500/10 text-slate-300",
  sending: "border-amber-300/40 bg-amber-500/10 text-amber-200",
  completed: "border-emerald-300/40 bg-emerald-500/10 text-emerald-200",
  cancelled: "border-rose-300/40 bg-rose-500/10 text-rose-200",
};

export function AdminCampaigns() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newChannel, setNewChannel] = useState<"email" | "whatsapp">("email");
  const { toast } = useToast();

  async function load() {
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()) as Campaign[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createDraft() {
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled campaign",
          channel: newChannel,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Campaign;
      setLocation(`/admin/campaigns/${created.id}/edit`);
    } catch (e) {
      toast({
        title: "Could not create campaign",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-6 pt-6 pb-12">
        <BrandHeader variant="compact" rightSlot={<AdminUserMenu />} />

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              data-testid="page-title-campaigns"
            >
              Campaigns
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              One-shot bulk outreach. Up to 200 recipients per campaign.
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={creating}
            data-testid="button-new-campaign"
          >
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            New campaign
          </Button>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen} key="new-campaign-dialog">
          <DialogContent data-testid="dialog-new-campaign">
            <DialogHeader>
              <DialogTitle>New campaign</DialogTitle>
              <DialogDescription>
                Pick a delivery channel. This is locked once the draft is created.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-xs text-slate-400">Channel</Label>
              <Select
                value={newChannel}
                onValueChange={(v) =>
                  setNewChannel(v as "email" | "whatsapp")
                }
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="select-new-channel"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                onClick={createDraft}
                disabled={creating}
                data-testid="button-confirm-create"
              >
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create draft
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {error ? (
          <Card className="border-rose-500/30 bg-rose-500/10">
            <CardContent className="py-4 text-sm text-rose-200">
              {error}
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-slate-700/40 bg-slate-900/40">
          <CardHeader>
            <CardTitle className="text-base">All campaigns</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {items === null ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-slate-400">
                No campaigns yet. Create your first one to start.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Skipped</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.id} data-testid={`row-campaign-${c.id}`}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                          {c.channel === "email" ? (
                            <Mail className="h-3.5 w-3.5" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5" />
                          )}
                          {c.channel}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[c.status]}
                          data-testid={`status-pill-${c.id}`}
                        >
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-200">
                        {c.recipientsSent}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-rose-200">
                        {c.recipientsFailed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-400">
                        {c.recipientsSkipped + c.recipientsUnsubscribed}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {format(new Date(c.createdAt), "MMM d, HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.status === "draft" ? (
                          <Link href={`/admin/campaigns/${c.id}/edit`}>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-edit-${c.id}`}
                            >
                              Edit
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`/admin/campaigns/${c.id}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-view-${c.id}`}
                            >
                              <Send className="mr-1.5 h-3.5 w-3.5" />
                              View
                            </Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
