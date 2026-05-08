import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminLayout } from "@/components/admin-layout";
import { useAdminAuth, type AdminUser } from "@/lib/adminAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, ShieldOff, ShieldCheck, RefreshCw, Trash2, Copy } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ApiUser extends AdminUser {}

async function listUsers(): Promise<ApiUser[]> {
  const res = await fetch(`${BASE}/api/admin/users`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load admins");
  const json = await res.json();
  return json.users as ApiUser[];
}

export function AdminUsers() {
  const { user, loading } = useAdminAuth();
  const [, setLocation] = useLocation();
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [tempPwModal, setTempPwModal] = useState<{
    user: ApiUser;
    password: string;
  } | null>(null);
  const { toast } = useToast();

  // Non-superadmins should not be here.
  useEffect(() => {
    if (loading) return;
    if (user && !user.isSuperadmin) setLocation("/admin");
  }, [loading, user, setLocation]);

  const refresh = async () => {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admins");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const onPatch = async (id: string, patch: Partial<ApiUser>) => {
    try {
      const res = await fetch(`${BASE}/api/admin/users/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Update failed");
      await refresh();
      toast({ title: "Updated" });
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  const onResetPw = async (target: ApiUser) => {
    if (
      !window.confirm(
        `Reset password for ${target.email}? They will be signed out and a new temporary password will be generated.`,
      )
    )
      return;
    try {
      const res = await fetch(`${BASE}/api/admin/users/${target.id}/reset`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Reset failed");
      setTempPwModal({ user: target, password: json.temporaryPassword });
    } catch (e) {
      toast({
        title: "Reset failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  const onDelete = async (target: ApiUser) => {
    if (
      !window.confirm(
        `Delete admin ${target.email}? This cannot be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(`${BASE}/api/admin/users/${target.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Delete failed");
      await refresh();
      toast({ title: "Admin deleted" });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  return (
    <AdminLayout
      title="Manage Admins"
      contentClassName="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8"
    >
      <div className="space-y-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-display font-semibold">
              Manage Admins
            </h1>
            <p className="text-sm text-muted-foreground">
              Add, deactivate, or reset passwords for admin accounts. Only
              superadmins see this page.
            </p>
          </div>
          <Button
            onClick={() => setOpenCreate(true)}
            data-testid="button-add-admin"
          >
            <Plus className="h-4 w-4 mr-2" /> Add admin
          </Button>
        </div>

        <Card className="p-4 md:p-6 shadow-lg border-border/40">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !users ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admins yet.</p>
          ) : (
            <Table data-testid="admin-users-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Display name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = user?.id === u.id;
                  return (
                    <TableRow key={u.id} data-testid={`row-admin-${u.id}`}>
                      <TableCell className="font-medium">
                        {u.email}
                        {isSelf ? (
                          <Badge variant="secondary" className="ml-2">
                            you
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{u.displayName ?? "—"}</TableCell>
                      <TableCell>
                        {u.isActive ? (
                          <Badge variant="outline">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Disabled</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.isSuperadmin ? (
                          <Badge className="bg-primary/15 text-primary border-transparent">
                            Superadmin
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            Admin
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {u.lastLoginAt
                          ? format(new Date(u.lastLoginAt), "PP p")
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {u.isActive ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSelf}
                            onClick={() =>
                              onPatch(u.id, { isActive: false })
                            }
                            data-testid={`button-disable-${u.id}`}
                          >
                            <ShieldOff className="h-3.5 w-3.5 mr-1" /> Disable
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onPatch(u.id, { isActive: true })}
                            data-testid={`button-enable-${u.id}`}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Enable
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResetPw(u)}
                          data-testid={`button-reset-${u.id}`}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset
                          password
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={isSelf}
                          onClick={() => onDelete(u)}
                          data-testid={`button-delete-${u.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <CreateAdminDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onCreated={async (created, tempPassword) => {
          setOpenCreate(false);
          await refresh();
          if (tempPassword) {
            setTempPwModal({ user: created, password: tempPassword });
          } else {
            toast({ title: "Admin created" });
          }
        }}
      />

      <Dialog open={Boolean(tempPwModal)} onOpenChange={(v) => !v && setTempPwModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary password</DialogTitle>
            <DialogDescription>
              Share this with{" "}
              <span className="font-medium">{tempPwModal?.user.email}</span>{" "}
              over a trusted channel — it is shown ONCE and cannot be
              retrieved later.
            </DialogDescription>
          </DialogHeader>
          <div
            className="rounded border bg-muted/40 p-3 font-mono text-sm break-all"
            data-testid="text-temp-password"
          >
            {tempPwModal?.password}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (tempPwModal) {
                  navigator.clipboard
                    .writeText(tempPwModal.password)
                    .then(() => toast({ title: "Copied to clipboard" }))
                    .catch(() => {});
                }
              }}
            >
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button onClick={() => setTempPwModal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function CreateAdminDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (created: ApiUser, tempPassword: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setDisplayName("");
    setIsSuperadmin(false);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/admin/users`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          displayName: displayName.trim() || undefined,
          isSuperadmin,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Create failed");
      reset();
      onCreated(json.user as ApiUser, json.temporaryPassword ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add admin</DialogTitle>
          <DialogDescription>
            A temporary password will be generated for the new admin. They
            should change it from the profile page after first login.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="new.admin@example.com"
              data-testid="input-new-admin-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-name">Display name (optional)</Label>
            <Input
              id="new-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid="input-new-admin-name"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="new-superadmin"
              checked={isSuperadmin}
              onCheckedChange={(v) => setIsSuperadmin(Boolean(v))}
              data-testid="checkbox-new-admin-superadmin"
            />
            <Label htmlFor="new-superadmin" className="cursor-pointer">
              Grant superadmin (can manage other admins)
            </Label>
          </div>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !email}
              data-testid="button-create-admin"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…
                </>
              ) : (
                "Create admin"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
