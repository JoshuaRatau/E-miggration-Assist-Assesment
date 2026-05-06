import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { BrandHeader } from "@/components/brand-header";
import { useAdminAuth } from "@/lib/adminAuth";
import { AdminUserMenu } from "@/components/admin-user-menu";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AdminProfile() {
  const { user } = useAdminAuth();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) {
      setError("New password must be at least 10 characters");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/auth/change-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? "Could not change password");
        return;
      }
      toast({ title: "Password updated", description: "Use the new password next time you sign in." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <BrandHeader variant="compact" rightSlot={<AdminUserMenu />} />
        <div className="space-y-2">
          <h1 className="text-3xl font-display font-semibold">Your profile</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium">{user?.email}</span>
            {user?.isSuperadmin ? " (superadmin)" : ""}.
          </p>
        </div>

        <Card className="p-6 md:p-8 shadow-lg border-border/40 space-y-6">
          <div>
            <h2 className="text-xl font-medium">Change password</h2>
            <p className="text-sm text-muted-foreground">
              At least 10 characters, with at least one letter and one digit.
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="next">New password</Label>
              <Input
                id="next"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
            {error ? (
              <p
                className="text-sm text-destructive"
                data-testid="text-profile-error"
              >
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={submitting || !current || !next || !confirm}
              data-testid="button-change-password"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
