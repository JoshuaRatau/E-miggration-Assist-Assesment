import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAdminAuth } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { BrandHeader } from "@/components/brand-header";
import { Loader2, ShieldCheck } from "lucide-react";
import heroFolders from "@assets/hero-folders-transparent.png";

export function AdminLogin() {
  const { login, user, loading } = useAdminAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the user is already signed in, bounce them straight to the
  // intended destination (preserved as ?next=).
  useEffect(() => {
    if (loading) return;
    if (user) {
      const params = new URLSearchParams(search);
      const next = params.get("next") || "/admin";
      setLocation(next.startsWith("/admin") ? next : "/admin");
    }
  }, [loading, user, search, setLocation]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      const params = new URLSearchParams(search);
      const next = params.get("next") || "/admin";
      setLocation(next.startsWith("/admin") ? next : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      {/*
        Two-column layout on lg+: glossy folder hero on the left as a
        visual anchor for the admin product, sign-in card on the right.
        Below lg the hero collapses to a smaller header image above the
        form so it never crowds out the actual login affordance on mobile.
      */}
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div className="hidden lg:flex flex-col items-start gap-6 pr-8">
          <BrandHeader variant="compact" />
          <img
            src={heroFolders}
            alt="E-Migration Assist case folders"
            className="w-full max-w-[520px] h-auto select-none drop-shadow-[0_30px_60px_rgba(37,99,235,0.25)]"
            data-testid="img-admin-hero"
            draggable={false}
          />
          <div className="max-w-md space-y-2">
            <h2 className="text-2xl font-display font-semibold tracking-tight">
              Lead intelligence, organised.
            </h2>
            <p className="text-sm text-muted-foreground">
              Sign in to triage individual and professional leads, track case
              progression, and keep your pipeline moving.
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md space-y-8">
          <div className="lg:hidden flex flex-col items-center gap-4">
            <BrandHeader variant="compact" />
            <img
              src={heroFolders}
              alt="E-Migration Assist case folders"
              className="w-40 h-auto select-none"
              draggable={false}
            />
          </div>
          <Card className="p-6 md:p-8 shadow-lg border-border/40 space-y-6">
          <div className="space-y-2 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-display font-semibold">
              Admin sign in
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter the email and password for your admin account.
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                data-testid="input-admin-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                data-testid="input-admin-password"
              />
            </div>
            {error ? (
              <p
                className="text-sm text-destructive"
                data-testid="text-admin-login-error"
              >
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !email || !password}
              data-testid="button-admin-login"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
          <div className="text-center text-sm">
            <Link
              href="/admin/forgot"
              className="text-primary underline-offset-4 hover:underline"
              data-testid="link-forgot-password"
            >
              Forgot password?
            </Link>
          </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
