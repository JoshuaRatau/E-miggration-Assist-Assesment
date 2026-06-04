import { useEffect, useRef, useState } from "react";
import { HeadphonesIcon, X, Send, CheckCircle2, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";
import { trackPixel } from "@/lib/metaPixel";

type Category =
  | "support_query"
  | "technical_issue"
  | "payment_account"
  | "general_question";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "support_query", label: "Support query" },
  { value: "technical_issue", label: "Technical issue / bug" },
  { value: "payment_account", label: "Payment / account" },
  { value: "general_question", label: "General question" },
];

const WELCOME =
  "Welcome to E-Migration Assist. Submit a support query, report a technical issue, ask a question, or request assistance with your application.";

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("support_query");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  function closePanel() {
    setOpen(false);
    // After a completed submission, return to a fresh form on next open.
    if (done) resetForm();
  }

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, done]);

  function resetForm() {
    setCategory("support_query");
    setName("");
    setEmail("");
    setMessage("");
    setWebsite("");
    setError(null);
    setDone(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (email.trim().length === 0) {
      setError("Please enter your email so we can reply.");
      return;
    }
    if (message.trim().length === 0) {
      setError("Please enter a short message so we can help.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl("/api/support"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          name: name.trim() || null,
          email: email.trim(),
          pagePath:
            typeof window !== "undefined" ? window.location.pathname : null,
          website,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Something went wrong.");
      }
      setDone(true);
      // Meta Pixel: user reached out via the support/contact widget.
      // No PII — descriptive params only.
      trackPixel("Contact", {
        content_name: "Support Widget",
        content_category: "support",
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not send your request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating launcher — fixed to the right edge. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="button-support-launcher"
          aria-label="Open Support Centre"
          className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full bg-[#0a1628] px-4 py-3 text-sm font-medium text-white shadow-lg shadow-black/30 ring-1 ring-[hsl(187_38%_52%)]/60 transition-all hover:bg-[#0d1d36] hover:ring-[hsl(187_38%_52%)] focus:outline-none focus:ring-2 focus:ring-[hsl(187_38%_52%)]"
        >
          <HeadphonesIcon className="h-5 w-5 text-[hsl(187_38%_52%)]" />
          <span className="hidden sm:inline">Support Centre</span>
        </button>
      )}

      {/* Support panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Support Centre"
          data-testid="panel-support"
          className="fixed bottom-0 right-0 z-[60] flex max-h-[90vh] w-full flex-col overflow-hidden border border-[hsl(187_38%_52%)]/30 bg-[#0a1628] text-white shadow-2xl shadow-black/40 sm:bottom-5 sm:right-5 sm:max-h-[80vh] sm:w-[380px] sm:rounded-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0d1d36] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(187_38%_52%)]/15">
                <HeadphonesIcon className="h-4 w-4 text-[hsl(187_38%_52%)]" />
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight">
                  Support Centre
                </p>
                <p className="text-[11px] text-slate-400 leading-tight">
                  We usually reply by email
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close Support Centre"
              data-testid="button-support-close"
              className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[hsl(187_38%_52%)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {done ? (
              <div
                className="flex flex-col items-center gap-3 py-8 text-center"
                data-testid="text-support-success"
              >
                <CheckCircle2 className="h-12 w-12 text-[hsl(187_38%_52%)]" />
                <p className="text-base font-semibold">Thank you!</p>
                <p className="text-sm text-slate-300">
                  Your request has been received. Our team will get back to you
                  as soon as possible.
                </p>
                <button
                  type="button"
                  onClick={resetForm}
                  data-testid="button-support-another"
                  className="mt-2 rounded-lg bg-[hsl(187_38%_52%)] px-4 py-2 text-sm font-medium text-[#0a1628] transition-opacity hover:opacity-90"
                >
                  Submit another request
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="rounded-lg bg-[hsl(187_38%_52%)]/10 px-3 py-2.5 text-[13px] leading-snug text-slate-200">
                  {WELCOME}
                </p>

                <div>
                  <label
                    htmlFor="support-category"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    How can we help?
                  </label>
                  <select
                    id="support-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    data-testid="select-support-category"
                    className="w-full rounded-lg border border-white/15 bg-[#0d1d36] px-3 py-2 text-sm text-white focus:border-[hsl(187_38%_52%)] focus:outline-none focus:ring-1 focus:ring-[hsl(187_38%_52%)]"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="support-name"
                      className="mb-1.5 block text-xs font-medium text-slate-300"
                    >
                      Name <span className="text-slate-500">(optional)</span>
                    </label>
                    <input
                      id="support-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      data-testid="input-support-name"
                      className="w-full rounded-lg border border-white/15 bg-[#0d1d36] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[hsl(187_38%_52%)] focus:outline-none focus:ring-1 focus:ring-[hsl(187_38%_52%)]"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="support-email"
                      className="mb-1.5 block text-xs font-medium text-slate-300"
                    >
                      Email
                    </label>
                    <input
                      id="support-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      data-testid="input-support-email"
                      className="w-full rounded-lg border border-white/15 bg-[#0d1d36] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[hsl(187_38%_52%)] focus:outline-none focus:ring-1 focus:ring-[hsl(187_38%_52%)]"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="support-message"
                    className="mb-1.5 block text-xs font-medium text-slate-300"
                  >
                    Message
                  </label>
                  <textarea
                    id="support-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    required
                    data-testid="input-support-message"
                    className="w-full resize-none rounded-lg border border-white/15 bg-[#0d1d36] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[hsl(187_38%_52%)] focus:outline-none focus:ring-1 focus:ring-[hsl(187_38%_52%)]"
                    placeholder="Tell us how we can help…"
                  />
                </div>

                {/* Honeypot — hidden from real users. */}
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute left-[-9999px] h-0 w-0 opacity-0"
                />

                {error && (
                  <p
                    className="text-xs text-red-400"
                    data-testid="text-support-error"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="button-support-submit"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[hsl(187_38%_52%)] px-4 py-2.5 text-sm font-semibold text-[#0a1628] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" /> Send request
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
