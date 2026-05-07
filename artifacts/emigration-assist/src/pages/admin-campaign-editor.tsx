import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandHeader } from "@/components/brand-header";
import { AdminUserMenu } from "@/components/admin-user-menu";
import { useToast } from "@/hooks/use-toast";
import {
  AudienceQueryBuilder,
  type AudienceQuery,
} from "@/components/audience-query-builder";
import { Loader2, Send, Trash2, FlaskConical, Save, Eye } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CampaignDraft {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  status: string;
  templateSubject: string | null;
  templateBody: string | null;
  whatsappTemplateSid: string | null;
  audienceFilter: AudienceQuery | null;
}

interface PreviewResult {
  total: number;
  unsubscribedCount: number;
  eligibleCount: number;
  cap: number;
}

export function AdminCampaignEditor() {
  const [, params] = useRoute<{ id: string }>("/admin/campaigns/:id/edit");
  const [, setLocation] = useLocation();
  const id = params?.id;
  const { toast } = useToast();

  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/admin/campaigns/${id}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { campaign: CampaignDraft };
        if (cancelled) return;
        setDraft(json.campaign);
        if (json.campaign.status !== "draft") {
          // Already sent — bounce to detail page.
          setLocation(`/admin/campaigns/${id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, setLocation]);

  // Debounced auto-save.
  useEffect(() => {
    if (!draft || !id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void save(draft);
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft?.name,
    draft?.templateSubject,
    draft?.templateBody,
    draft?.whatsappTemplateSid,
    JSON.stringify(draft?.audienceFilter ?? null),
  ]);

  async function save(d: CampaignDraft) {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns/${d.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: d.name,
          templateSubject: d.templateSubject,
          templateBody: d.templateBody,
          whatsappTemplateSid: d.whatsappTemplateSid,
          audienceFilter: d.audienceFilter,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
    } catch (e) {
      toast({
        title: "Auto-save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    if (!draft) return;
    setPreviewing(true);
    try {
      const res = await fetch(
        `${BASE}/api/admin/campaigns/${draft.id}/preview`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPreview((await res.json()) as PreviewResult);
    } catch (e) {
      toast({
        title: "Preview failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest() {
    if (!draft) return;
    setTesting(true);
    try {
      const res = await fetch(
        `${BASE}/api/admin/campaigns/${draft.id}/test`,
        { method: "POST", credentials: "include" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({
        title: json.sent ? "Test sent" : "Test failed",
        description: json.sent
          ? "Check your admin email inbox."
          : `Reason: ${json.reason}`,
        variant: json.sent ? "default" : "destructive",
      });
    } catch (e) {
      toast({
        title: "Test failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  async function sendForReal() {
    if (!draft) return;
    setSending(true);
    try {
      const res = await fetch(
        `${BASE}/api/admin/campaigns/${draft.id}/send`,
        { method: "POST", credentials: "include" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast({
        title: "Campaign sent",
        description: `Sent: ${json.tally.sent} · Failed: ${json.tally.failed} · Skipped: ${json.tally.skipped + json.tally.unsub}`,
      });
      setConfirmOpen(false);
      setLocation(`/admin/campaigns/${draft.id}`);
    } catch (e) {
      toast({
        title: "Send failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  async function deleteDraft() {
    if (!draft) return;
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    try {
      const res = await fetch(`${BASE}/api/admin/campaigns/${draft.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLocation("/admin/campaigns");
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const audience = useMemo<AudienceQuery>(
    () => draft?.audienceFilter ?? { combinator: "and", rules: [] },
    [draft],
  );

  if (error)
    return (
      <div className="min-h-screen bg-slate-950 p-8 text-rose-300">{error}</div>
    );
  if (!draft)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );

  const overCap = (preview?.eligibleCount ?? 0) > (preview?.cap ?? 200);
  const canSend =
    !!preview &&
    preview.eligibleCount > 0 &&
    !overCap &&
    (draft.channel === "whatsapp" ||
      ((draft.templateBody ?? "").trim().length > 0 &&
        (draft.templateSubject ?? "").trim().length > 0));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 pt-6 pb-12">
        <BrandHeader variant="compact" rightSlot={<AdminUserMenu />} />

        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex-1">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-10 max-w-lg bg-slate-900/40 text-base font-semibold"
              data-testid="input-campaign-name"
            />
            <div className="mt-1 text-xs text-slate-400">
              {saving ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              ) : (
                <span>Auto-saved</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteDraft}
              data-testid="button-delete-draft"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => save(draft)}
              data-testid="button-save-now"
            >
              <Save className="mr-2 h-4 w-4" />
              Save now
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card className="border-slate-700/40 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base">Channel & message</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs text-slate-400">Channel</Label>
                  <div className="mt-1 text-sm text-slate-200">
                    <Badge
                      variant="outline"
                      className="border-slate-300/40 bg-slate-500/10 text-slate-200"
                    >
                      {draft.channel}
                    </Badge>
                    <span className="ml-2 text-xs text-slate-500">
                      (locked at create)
                    </span>
                  </div>
                </div>

                {draft.channel === "email" ? (
                  <>
                    <div>
                      <Label htmlFor="subject" className="text-xs text-slate-400">
                        Subject
                      </Label>
                      <Input
                        id="subject"
                        value={draft.templateSubject ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            templateSubject: e.target.value,
                          })
                        }
                        placeholder="Update on your application"
                        className="mt-1 bg-slate-950/40"
                        data-testid="input-template-subject"
                      />
                    </div>
                    <div>
                      <Label htmlFor="body" className="text-xs text-slate-400">
                        Body
                      </Label>
                      <Textarea
                        id="body"
                        value={draft.templateBody ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, templateBody: e.target.value })
                        }
                        rows={10}
                        className="mt-1 bg-slate-950/40 font-mono text-sm"
                        placeholder={`Hi {{first_name}},\n\nWe wanted to share an update...\n\nReference: {{reference}}`}
                        data-testid="textarea-template-body"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Tokens:{" "}
                        <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                          {"{{first_name}}"}
                        </code>{" "}
                        <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                          {"{{full_name}}"}
                        </code>{" "}
                        <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                          {"{{reference}}"}
                        </code>{" "}
                        <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                          {"{{organization_name}}"}
                        </code>
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Label
                        htmlFor="wa-template"
                        className="text-xs text-slate-400"
                      >
                        Twilio template Content SID (cold outreach)
                      </Label>
                      <Input
                        id="wa-template"
                        value={draft.whatsappTemplateSid ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            whatsappTemplateSid: e.target.value,
                          })
                        }
                        placeholder="HX…"
                        className="mt-1 bg-slate-950/40 font-mono text-sm"
                        data-testid="input-wa-template-sid"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Required for any contact who hasn't messaged us in the
                        last 24 hours. Must be a Meta-approved template.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="wa-body" className="text-xs text-slate-400">
                        Free-form body (used inside the 24h window)
                      </Label>
                      <Textarea
                        id="wa-body"
                        value={draft.templateBody ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, templateBody: e.target.value })
                        }
                        rows={6}
                        className="mt-1 bg-slate-950/40 font-mono text-sm"
                        placeholder="Hi {{first_name}}, quick update…"
                        data-testid="textarea-template-body"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-700/40 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base">Audience</CardTitle>
              </CardHeader>
              <CardContent>
                <AudienceQueryBuilder
                  value={audience}
                  onChange={(q) => setDraft({ ...draft, audienceFilter: q })}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-slate-700/40 bg-slate-900/40">
              <CardHeader>
                <CardTitle className="text-base">Preview & send</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={runPreview}
                  disabled={previewing}
                  data-testid="button-run-preview"
                >
                  {previewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  Count audience
                </Button>

                {preview ? (
                  <div className="space-y-2 rounded border border-slate-700/40 bg-slate-950/40 p-3 text-sm">
                    <Row label="Matches filter" value={preview.total} />
                    <Row
                      label="Already unsubscribed"
                      value={preview.unsubscribedCount}
                      tone="slate"
                    />
                    <Row
                      label="Will receive"
                      value={preview.eligibleCount}
                      tone={overCap ? "rose" : "emerald"}
                      bold
                    />
                    {overCap ? (
                      <p className="mt-2 text-xs text-rose-300">
                        Audience exceeds the {preview.cap}-recipient cap. Tighten
                        the rules to send.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={sendTest}
                  disabled={testing}
                  data-testid="button-send-test"
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FlaskConical className="mr-2 h-4 w-4" />
                  )}
                  Send test to me
                </Button>

                <Button
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canSend || sending}
                  data-testid="button-open-send-confirm"
                >
                  {sending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send campaign
                </Button>
                {!canSend && preview ? (
                  <p className="text-xs text-slate-500">
                    {draft.channel === "email" &&
                    ((draft.templateSubject ?? "").trim().length === 0 ||
                      (draft.templateBody ?? "").trim().length === 0)
                      ? "Subject and body are required."
                      : preview.eligibleCount === 0
                        ? "No eligible recipients."
                        : null}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent data-testid="dialog-send-confirm">
            <DialogHeader>
              <DialogTitle>Send to {preview?.eligibleCount ?? 0} leads?</DialogTitle>
              <DialogDescription>
                This will dispatch the message immediately. Sends are
                synchronous and may take up to ~2 minutes for the full audience.
                You'll be redirected to the campaign report when finished.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                onClick={sendForReal}
                disabled={sending}
                data-testid="button-confirm-send"
              >
                {sending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Yes, send now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "slate",
  bold,
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "rose";
  bold?: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "rose"
        ? "text-rose-300"
        : "text-slate-300";
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">{label}</span>
      <span
        className={`tabular-nums ${toneClass} ${bold ? "text-base font-semibold" : "text-sm"}`}
      >
        {value}
      </span>
    </div>
  );
}
