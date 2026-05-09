import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
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
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/lib/adminAuth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Plus,
  Send,
  Mail,
  MessageSquare,
  Archive,
  ArchiveRestore,
  Eye,
  Save,
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TabKey = "campaigns" | "templates" | "notifications" | "reports";

const TABS: Array<{ key: TabKey; href: string; label: string; testId: string }> = [
  {
    key: "campaigns",
    href: "/admin/communications",
    label: "Campaigns",
    testId: "tab-campaigns",
  },
  {
    key: "templates",
    href: "/admin/communications/templates",
    label: "Templates",
    testId: "tab-templates",
  },
  {
    key: "notifications",
    href: "/admin/communications/notifications",
    label: "System Notifications",
    testId: "tab-notifications",
  },
  {
    key: "reports",
    href: "/admin/communications/reports",
    label: "Reports",
    testId: "tab-reports",
  },
];

function tabFromLocation(loc: string): TabKey {
  if (loc.startsWith("/admin/communications/templates")) return "templates";
  if (loc.startsWith("/admin/communications/notifications"))
    return "notifications";
  if (loc.startsWith("/admin/communications/reports")) return "reports";
  return "campaigns";
}

export function AdminCommunications() {
  const [location] = useLocation();
  const active = tabFromLocation(location);

  return (
    <AdminLayout
      title="Communications"
      bodyClassName="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100"
      contentClassName="flex-1 mx-auto max-w-7xl w-full px-6 pt-6 pb-12"
    >
      <>
        <div className="mb-2">
          <h1
            className="text-2xl font-semibold tracking-tight"
            data-testid="page-title-communications"
          >
            Communications
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Outbound campaigns, message templates, system notifications, and
            delivery reports.
          </p>
        </div>

        <div
          className="mt-6 mb-6 -mx-4 sm:mx-0 px-4 sm:px-0 flex gap-1 border-b border-slate-700/40 overflow-x-auto whitespace-nowrap scrollbar-thin"
          role="tablist"
          aria-label="Communications sections"
        >
          {TABS.map((t) => {
            const isActive = t.key === active;
            return (
              <Link key={t.key} href={t.href}>
                <a
                  role="tab"
                  aria-selected={isActive}
                  data-testid={t.testId}
                  className={
                    "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 " +
                    (isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-slate-400 hover:text-slate-200")
                  }
                >
                  {t.label}
                </a>
              </Link>
            );
          })}
        </div>

        {active === "campaigns" ? <CampaignsPanel /> : null}
        {active === "templates" ? <TemplatesPanel /> : null}
        {active === "notifications" ? (
          <ComingSoonPanel kind="notifications" />
        ) : null}
        {active === "reports" ? <ReportsPanel /> : null}
      </>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------------------
// Campaigns panel — embedded list (was the standalone /admin/campaigns page).

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

function CampaignsPanel() {
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
      setLocation(`/admin/communications/campaigns/${created.id}/edit`);
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
    <div data-testid="panel-campaigns">
      <div className="mb-4 flex items-center justify-end">
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
              onValueChange={(v) => setNewChannel(v as "email" | "whatsapp")}
            >
              <SelectTrigger className="mt-1" data-testid="select-new-channel">
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
        <Card className="mb-4 border-rose-500/30 bg-rose-500/10">
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
            <div className="overflow-x-auto">
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
                        <Link
                          href={`/admin/communications/campaigns/${c.id}/edit`}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-edit-${c.id}`}
                          >
                            Edit
                          </Button>
                        </Link>
                      ) : (
                        <Link href={`/admin/communications/campaigns/${c.id}`}>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates panel — Phase 5 §3.C.

interface CommTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  unknownTokens: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

type TemplateCategory =
  | "promotional"
  | "system_update"
  | "new_feature"
  | "educational"
  | "customer_experience";

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  promotional: "Promotional",
  system_update: "System Update",
  new_feature: "New Feature",
  educational: "Educational",
  customer_experience: "Customer Experience",
};

const CATEGORY_TONE: Record<TemplateCategory, string> = {
  promotional: "border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-200",
  system_update: "border-amber-300/40 bg-amber-500/10 text-amber-200",
  new_feature: "border-sky-300/40 bg-sky-500/10 text-sky-200",
  educational: "border-emerald-300/40 bg-emerald-500/10 text-emerald-200",
  customer_experience: "border-rose-300/40 bg-rose-500/10 text-rose-200",
};

const CATEGORIES: TemplateCategory[] = [
  "promotional",
  "system_update",
  "new_feature",
  "educational",
  "customer_experience",
];

function TemplatesPanel() {
  const { toast } = useToast();
  const { user: currentAdmin } = useAdminAuth();
  const [items, setItems] = useState<CommTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<
    TemplateCategory | "all"
  >("all");
  const [filterChannel, setFilterChannel] = useState<
    "all" | "email" | "whatsapp"
  >("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newChannel, setNewChannel] = useState<"email" | "whatsapp">("email");
  const [newCategory, setNewCategory] = useState<TemplateCategory>(
    "promotional",
  );
  const [seeding, setSeeding] = useState(false);

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      const res = await fetch(`${BASE}/api/admin/templates/seed-defaults`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        inserted?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok) {
        toast({
          title: "Couldn't restore defaults",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title:
          body.inserted && body.inserted > 0
            ? `Restored ${body.inserted} template${body.inserted === 1 ? "" : "s"}`
            : "Library already complete",
        description:
          body.inserted && body.inserted > 0
            ? `Existing templates were preserved. ${body.skipped ?? 0} already in place.`
            : "All 20 default templates are already in your library.",
      });
      await load();
    } catch (e) {
      toast({
        title: "Couldn't restore defaults",
        description: e instanceof Error ? e.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  }

  async function load() {
    try {
      const params = new URLSearchParams();
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterChannel !== "all") params.set("channel", filterChannel);
      if (includeArchived) params.set("includeArchived", "true");
      const url = `${BASE}/api/admin/templates${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { templates: CommTemplate[] };
      setItems(json.templates);
      // If the selected template is no longer in the filtered list, clear.
      if (selectedId && !json.templates.find((t) => t.id === selectedId)) {
        setSelectedId(null);
        setDraft(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory, filterChannel, includeArchived]);

  // When user clicks a template in the list, hydrate the editor with a
  // local copy so edits don't mutate the list-cache row directly.
  function selectTemplate(t: CommTemplate) {
    setSelectedId(t.id);
    setDraft({ ...t });
  }

  async function createTemplate() {
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/templates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled template",
          category: newCategory,
          channel: newChannel,
          subject: newChannel === "email" ? "Subject line" : null,
          body: "Hi {{first_name}}, …",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { template: CommTemplate };
      setCreateOpen(false);
      await load();
      selectTemplate(json.template);
    } catch (e) {
      toast({
        title: "Could not create template",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/admin/templates/${draft.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          category: draft.category,
          subject: draft.channel === "email" ? draft.subject : null,
          body: draft.body,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { template: CommTemplate };
      setDraft(json.template);
      await load();
      toast({ title: "Template saved" });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(t: CommTemplate) {
    const action = t.archivedAt ? "unarchive" : "archive";
    try {
      const res = await fetch(
        `${BASE}/api/admin/templates/${t.id}/${action}`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      if (selectedId === t.id) {
        const json = (await res.json()) as { template: CommTemplate };
        setDraft(json.template);
      }
      toast({ title: action === "archive" ? "Archived" : "Restored" });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  // Live preview — render against fixed sample context client-side.
  // Server-side preview exists too but this avoids a roundtrip per keystroke.
  const previewSubject = useMemo(
    () =>
      draft?.subject ? renderSampleTokens(draft.subject) : null,
    [draft?.subject],
  );
  const previewBody = useMemo(
    () => (draft ? renderSampleTokens(draft.body) : ""),
    [draft?.body],
  );
  const unknownTokens = useMemo(
    () => (draft ? findUnknownSampleTokens(draft.body) : []),
    [draft?.body],
  );

  const isArchived = !!draft?.archivedAt;

  return (
    <div data-testid="panel-templates" className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFilterCategory("all")}
            className={
              "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors " +
              (filterCategory === "all"
                ? "border-primary bg-primary/10 text-primary"
                : "border-slate-700/50 text-slate-400 hover:text-slate-200")
            }
            data-testid="filter-cat-all"
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilterCategory(c)}
              className={
                "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors " +
                (filterCategory === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-slate-700/50 text-slate-400 hover:text-slate-200")
              }
              data-testid={`filter-cat-${c}`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={filterChannel}
            onValueChange={(v) =>
              setFilterChannel(v as "all" | "email" | "whatsapp")
            }
          >
            <SelectTrigger
              className="h-8 w-[130px] text-xs"
              data-testid="filter-channel"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              data-testid="filter-include-archived"
            />
            Show archived
          </label>
          {currentAdmin?.isSuperadmin ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSeedDefaults}
              disabled={seeding}
              data-testid="button-seed-defaults"
              title="Re-seed any missing templates from the default library. Existing templates are not overwritten."
            >
              {seeding ? "Restoring…" : "Restore defaults"}
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            data-testid="button-new-template"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New template
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-rose-500/30 bg-rose-500/10">
          <CardContent className="py-4 text-sm text-rose-200">
            {error}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* List pane */}
        <Card className="border-slate-700/40 bg-slate-900/40 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">
              Templates {items ? `(${items.length})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {items === null ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-slate-400">
                No templates match. Create one to get started.
              </div>
            ) : (
              <ul className="divide-y divide-slate-700/40">
                {items.map((t) => {
                  const active = t.id === selectedId;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => selectTemplate(t)}
                        className={
                          "w-full text-left px-4 py-3 transition-colors " +
                          (active
                            ? "bg-slate-800/60"
                            : "hover:bg-slate-800/30")
                        }
                        data-testid={`row-template-${t.id}`}
                      >
                        <div className="flex items-center gap-2">
                          {t.channel === "email" ? (
                            <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="text-sm font-medium text-slate-200 truncate">
                            {t.name}
                          </span>
                          {t.archivedAt ? (
                            <Badge
                              variant="outline"
                              className="ml-auto border-slate-500/40 bg-slate-500/10 text-slate-400 text-[10px]"
                            >
                              archived
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              CATEGORY_TONE[t.category] +
                              " text-[10px] font-normal"
                            }
                          >
                            {CATEGORY_LABEL[t.category]}
                          </Badge>
                          <span className="text-[10px] text-slate-500">
                            {format(new Date(t.updatedAt), "MMM d")}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Editor pane */}
        <Card className="border-slate-700/40 bg-slate-900/40 lg:col-span-2">
          {!draft ? (
            <CardContent className="py-16 text-center text-sm text-slate-400">
              Select a template to edit, or create a new one.
            </CardContent>
          ) : (
            <>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Edit template</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleArchive(draft)}
                    data-testid="button-toggle-archive"
                  >
                    {isArchived ? (
                      <>
                        <ArchiveRestore className="mr-1.5 h-4 w-4" />
                        Restore
                      </>
                    ) : (
                      <>
                        <Archive className="mr-1.5 h-4 w-4" />
                        Archive
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveDraft}
                    disabled={saving || isArchived}
                    data-testid="button-save-template"
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isArchived ? (
                  <div className="rounded border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-xs text-slate-300">
                    This template is archived. Restore it to make changes.
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs text-slate-400">Name</Label>
                    <Input
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                      disabled={isArchived}
                      className="mt-1 bg-slate-950/40"
                      data-testid="input-template-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Category</Label>
                    <Select
                      value={draft.category}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          category: v as TemplateCategory,
                        })
                      }
                      disabled={isArchived}
                    >
                      <SelectTrigger
                        className="mt-1"
                        data-testid="select-template-category"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-slate-400">
                    Channel{" "}
                    <span className="text-slate-500">(locked at create)</span>
                  </Label>
                  <div className="mt-1">
                    <Badge
                      variant="outline"
                      className="border-slate-300/40 bg-slate-500/10 text-slate-200"
                    >
                      {draft.channel}
                    </Badge>
                  </div>
                </div>

                {draft.channel === "email" ? (
                  <div>
                    <Label className="text-xs text-slate-400">Subject</Label>
                    <Input
                      value={draft.subject ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, subject: e.target.value })
                      }
                      disabled={isArchived}
                      className="mt-1 bg-slate-950/40"
                      data-testid="input-template-subject"
                    />
                  </div>
                ) : null}

                <div>
                  <Label className="text-xs text-slate-400">Body</Label>
                  <Textarea
                    value={draft.body}
                    onChange={(e) =>
                      setDraft({ ...draft, body: e.target.value })
                    }
                    disabled={isArchived}
                    rows={8}
                    className="mt-1 bg-slate-950/40 font-mono text-sm"
                    data-testid="textarea-template-body"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Tokens:{" "}
                    {[
                      "{{first_name}}",
                      "{{full_name}}",
                      "{{reference}}",
                      "{{organization_name}}",
                    ].map((t) => (
                      <code
                        key={t}
                        className="rounded bg-slate-800 px-1 py-0.5 mr-1 text-slate-300"
                      >
                        {t}
                      </code>
                    ))}
                  </p>
                  {unknownTokens.length > 0 ? (
                    <p
                      className="mt-1.5 text-xs text-amber-300"
                      data-testid="warning-unknown-tokens"
                    >
                      Unknown tokens (will be left as-is on send):{" "}
                      {unknownTokens.map((t) => `{{${t}}}`).join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded border border-slate-700/40 bg-slate-950/40 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                    <Eye className="h-3.5 w-3.5" />
                    Live preview (sample data)
                  </div>
                  {previewSubject ? (
                    <div className="mb-2 text-sm">
                      <span className="text-slate-500">Subject:</span>{" "}
                      <span className="text-slate-200">{previewSubject}</span>
                    </div>
                  ) : null}
                  <div
                    className="whitespace-pre-wrap text-sm text-slate-200"
                    data-testid="preview-body"
                  >
                    {previewBody}
                  </div>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-new-template">
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              Channel is locked once created. You can rename and edit
              everything else later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs text-slate-400">Channel</Label>
              <Select
                value={newChannel}
                onValueChange={(v) =>
                  setNewChannel(v as "email" | "whatsapp")
                }
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="select-new-template-channel"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Category</Label>
              <Select
                value={newCategory}
                onValueChange={(v) =>
                  setNewCategory(v as TemplateCategory)
                }
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="select-new-template-category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              onClick={createTemplate}
              disabled={creating}
              data-testid="button-confirm-create-template"
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Client-side mirror of the server's render context. Kept tiny on purpose —
// must match the four supported tokens in `lib/campaignRender.ts`.
const SAMPLE_TOKENS: Record<string, string> = {
  first_name: "Alex",
  full_name: "Alex Mokoena",
  reference: "EMA-DEMO-0001",
  organization_name: "Acme Immigration Co",
};
const TOKEN_RE_FE = /\{\{\s*([a-z_]+)\s*\}\}/g;

function renderSampleTokens(input: string): string {
  return input.replace(TOKEN_RE_FE, (m, name) =>
    SAMPLE_TOKENS[name] !== undefined ? SAMPLE_TOKENS[name]! : m,
  );
}

function findUnknownSampleTokens(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of input.matchAll(TOKEN_RE_FE)) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    if (!(name in SAMPLE_TOKENS)) out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coming-soon placeholder for System Notifications.

function ComingSoonPanel({ kind }: { kind: "notifications" }) {
  const copy = {
    title: "System notifications",
    body: "Configure operator-facing alerts (lead-stage changes, SLA breaches, failed sends) and the channels they fire on. Coming soon.",
  };
  return (
    <Card
      className="border-slate-700/40 bg-slate-900/40"
      data-testid={`panel-${kind}`}
    >
      <CardContent className="py-12 text-center">
        <h2 className="text-lg font-semibold text-slate-200">{copy.title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          {copy.body}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reports panel — DB-only stats. Open/click rates intentionally omitted.

interface ReportsTotals {
  totalCampaigns: number;
  drafts: number;
  sending: number;
  completed: number;
  cancelled: number;
  emailCampaigns: number;
  whatsappCampaigns: number;
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsSkipped: number;
  recipientsUnsubscribed: number;
}

interface ReportsRecent {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  status: string;
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  sentAt: string | null;
  createdAt: string;
}

function ReportsPanel() {
  const [data, setData] = useState<{
    totals: ReportsTotals;
    recent: ReportsRecent[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/admin/campaigns/stats`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load reports");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const successRate = useMemo(() => {
    if (!data) return null;
    const denom = data.totals.recipientsSent + data.totals.recipientsFailed;
    if (denom === 0) return null;
    return Math.round((data.totals.recipientsSent / denom) * 1000) / 10;
  }, [data]);

  if (error)
    return (
      <Card
        className="border-rose-500/30 bg-rose-500/10"
        data-testid="panel-reports-error"
      >
        <CardContent className="py-4 text-sm text-rose-200">{error}</CardContent>
      </Card>
    );
  if (!data)
    return (
      <div
        className="flex items-center justify-center py-12"
        data-testid="panel-reports-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );

  const t = data.totals;

  return (
    <div data-testid="panel-reports" className="space-y-6">
      <p className="text-xs text-slate-500">
        Reports show what the database knows: how many campaigns, how many
        recipients, and how many sends succeeded vs failed. Email open and
        link-click tracking are not yet wired and will appear here once
        provider webhooks are connected.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total campaigns" value={t.totalCampaigns} />
        <Stat label="Drafts" value={t.drafts} tone="slate" />
        <Stat label="Completed" value={t.completed} tone="emerald" />
        <Stat label="Cancelled" value={t.cancelled} tone="rose" />
      </div>

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">Delivery totals (all time)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Recipients" value={t.recipientsTotal} bold />
            <Stat label="Sent" value={t.recipientsSent} tone="emerald" bold />
            <Stat label="Failed" value={t.recipientsFailed} tone="rose" bold />
            <Stat label="Skipped" value={t.recipientsSkipped} />
            <Stat
              label="Unsubscribed"
              value={t.recipientsUnsubscribed}
              tone="amber"
            />
          </div>
          {successRate !== null ? (
            <p
              className="mt-4 text-xs text-slate-400"
              data-testid="reports-success-rate"
            >
              Send success rate:{" "}
              <span className="text-slate-200 font-medium tabular-nums">
                {successRate}%
              </span>{" "}
              ({t.recipientsSent.toLocaleString()} of{" "}
              {(t.recipientsSent + t.recipientsFailed).toLocaleString()}{" "}
              attempts)
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">By channel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Email campaigns"
              value={t.emailCampaigns}
              tone="violet"
            />
            <Stat
              label="WhatsApp campaigns"
              value={t.whatsappCampaigns}
              tone="emerald"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/40 bg-slate-900/40">
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.recent.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-400">
              No campaigns yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Sent at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r) => (
                  <TableRow
                    key={r.id}
                    data-testid={`reports-recent-row-${r.id}`}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/admin/communications/campaigns/${r.id}`}>
                        <a className="text-slate-200 hover:text-primary">
                          {r.name}
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                        {r.channel === "email" ? (
                          <Mail className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                        {r.channel}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {r.status}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-200">
                      {r.recipientsSent}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-200">
                      {r.recipientsFailed}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {r.sentAt
                        ? format(new Date(r.sentAt), "MMM d, HH:mm")
                        : "—"}
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
  );
}

function Stat({
  label,
  value,
  tone = "slate",
  bold,
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "rose" | "amber" | "violet";
  bold?: boolean;
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "rose"
        ? "text-rose-300"
        : tone === "amber"
          ? "text-amber-300"
          : tone === "violet"
            ? "text-violet-300"
            : "text-slate-200";
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div
        className={`mt-1 ${bold ? "text-2xl" : "text-xl"} font-semibold tabular-nums ${cls}`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
