import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { BrandHeader } from "@/components/brand-header";
import { Loader2, MailCheck } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AdminForgot() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch(`${BASE}/api/admin/auth/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
    } catch {
      /* the endpoint is best-effort and always returns 200 */
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto space-y-8">
        <BrandHeader variant="compact" />
        <Card className="p-6 md:p-8 shadow-lg border-border/40 space-y-6">
          <div className="space-y-2 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
              <MailCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-display font-semibold">
              Reset your password
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter the email associated with your admin account. If we
              find a match, we'll email you a one-hour reset link.
            </p>
          </div>
          {submitted ? (
            <div
              className="space-y-4 text-sm text-muted-foreground text-center"
              data-testid="forgot-confirmation"
            >
              <p>
                If <span className="font-medium">{email}</span> is registered,
                a reset link is on its way. Check your inbox (and your spam
                folder).
              </p>
              <Link
                href="/admin/login"
                className="inline-block text-primary underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  data-testid="input-forgot-email"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !email}
                data-testid="button-send-reset"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…
                  </>
                ) : (
                  "Send reset link"
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
