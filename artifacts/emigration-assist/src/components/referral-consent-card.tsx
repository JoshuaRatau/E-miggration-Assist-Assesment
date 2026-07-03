import { useState } from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/lib/apiBase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Handshake, ArrowRight } from "lucide-react";

const CONSENT_TEXT_VERSION = "v1";

type ConsentResult = {
  referralId: string;
  status: string;
  matched: boolean;
};

/**
 * POPIA opt-in consent surface shown on the confirmation page. The applicant
 * explicitly agrees to have a redacted summary of their matter shared with a
 * vetted partner immigration firm. No personal contact detail leaves this app
 * until a conflict check passes inside EMA.
 */
export function ReferralConsentCard({
  referenceNumber,
}: {
  referenceNumber: string;
}) {
  const [, navigate] = useLocation();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ConsentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/referrals/consent"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          referenceNumber,
          consentToShareWithPartnerFirms: true,
          consentTextVersion: CONSENT_TEXT_VERSION,
          consentSourcePage: "/thank-you",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `consent_failed_${res.status}`);
      }
      setResult((await res.json()) as ConsentResult);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Please retry.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-lg font-display">
            {result.matched
              ? "A partner firm can help"
              : "Thank you — you're on the list"}
          </CardTitle>
          <CardDescription>
            {result.matched
              ? "We matched your matter with a vetted immigration firm. Review the redacted summary and continue when you're ready."
              : "We've recorded your consent. If a suitable partner firm becomes available for your matter, we'll be in touch."}
          </CardDescription>
        </CardHeader>
        {result.matched ? (
          <CardContent>
            <Button
              onClick={() => navigate(`/referral-preview/${result.referralId}`)}
              data-testid="button-view-referral"
            >
              View my referral
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Handshake className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-lg font-display">
              Get matched with a vetted firm
            </CardTitle>
            <CardDescription>
              Optional — connect with a partner immigration firm.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            data-testid="checkbox-referral-consent"
            className="mt-1"
          />
          <span className="text-sm text-muted-foreground leading-relaxed">
            I consent to a redacted summary of my matter (matter type, urgency,
            and region — never my contact details) being shared with a vetted
            partner immigration firm so they can offer to assist me. My full
            details are only released after a conflict check passes.
          </span>
        </label>

        {error ? (
          <div className="text-sm text-red-400" data-testid="text-consent-error">
            We couldn't record your consent right now. Please try again.
          </div>
        ) : null}

        <Button
          onClick={submit}
          disabled={!agreed || submitting}
          data-testid="button-referral-consent"
        >
          {submitting ? "Submitting…" : "Match me with a firm"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default ReferralConsentCard;
