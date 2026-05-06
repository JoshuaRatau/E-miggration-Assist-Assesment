import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { BrandHeader } from "@/components/brand-header";
import { Loader2, KeyRound } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AdminReset() {
  const [, params] = useRoute("/admin/reset/:token");
  const token = params?.token ?? "";
  const [, setLocation] = useLocation();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    if (pw !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/auth/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? "Could not reset password");
        return;
      }
      setSuccess(true);
      setTimeout(() => setLocation("/admin/login"), 2000);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto space-y-8">
        <BrandHeader variant="compact" />
        <Card className="p-6 md:p-8 shadow-lg border-border/40 space-y-6">
          <div className="space-y-2 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
              <KeyRound className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-display font-semibold">
              Choose a new password
            </h1>
            <p className="text-sm text-muted-foreground">
              At least 10 characters, with at least one letter and one digit.
            </p>
          </div>
          {success ? (
            <p
              className="text-sm text-center text-muted-foreground"
              data-testid="reset-success"
            >
              Password updated. Redirecting to sign in…
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">New password</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  data-testid="input-reset-password"
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
                  data-testid="input-reset-confirm"
                />
              </div>
              {error ? (
                <p
                  className="text-sm text-destructive"
                  data-testid="text-reset-error"
                >
                  {error}
                </p>
              ) : null}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !pw || !confirm}
                data-testid="button-confirm-reset"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                  </>
                ) : (
                  "Update password"
                )}
              </Button>
              <div className="text-center text-sm">
                <Link
                  href="/admin/login"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
