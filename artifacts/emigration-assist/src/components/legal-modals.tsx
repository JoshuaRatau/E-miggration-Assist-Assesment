import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const LEGAL_REVIEW_BANNER =
  "PLACEHOLDER COPY — AWAITING FINAL LEGAL REVIEW. Final wording will be supplied by our admitted attorneys before public launch.";

const TERMS_OF_USE_BODY = [
  "By using E-Migration Assist you agree to provide accurate information about your immigration situation. The platform performs a structured, preliminary assessment based on the information you submit.",
  "E-Migration Assist is provided by eRide Technologies and is an information-gathering and triage tool. It is not legal representation, does not create an attorney–client relationship, and does not bind any government department.",
  "You are responsible for keeping your login or reference details secure. If you suspect unauthorised access to your reference number, please notify our team.",
  "We reserve the right to update these terms before public launch. Continued use after an update constitutes acceptance of the revised terms.",
];

const PRIVACY_NOTICE_BODY = [
  "We collect the information you submit through the assessment form (name, contact details, immigration situation, supporting documents) for the sole purpose of preparing your case for review.",
  "Your information is held confidentially and is not shared with the South African Department of Home Affairs or any other government department without your express, informed consent.",
  "Documents you upload are stored privately, linked only to your reference record. You may request deletion at any time by contacting our team with your reference number.",
  "We comply with the Protection of Personal Information Act (POPIA) and apply industry-standard safeguards to your data.",
];

const DISCLAIMER_BODY = [
  "The output of E-Migration Assist is a preliminary, system-generated indication only. It is not a legal opinion, not a determination by any government body, and not a guarantee of any outcome.",
  "Immigration law is fact-specific and changes frequently. A formal review by a qualified consultant or admitted attorney is required before any application or representation is made on your behalf.",
  "If your situation involves urgent timelines (visa expiry, travel dates, declared statuses), please ensure you act on professional advice — not on this preliminary indication alone.",
];

type ModalKind = "terms" | "privacy" | "disclaimer";

interface LegalLinkProps {
  kind: ModalKind;
  children: React.ReactNode;
}

function modalCopy(kind: ModalKind): { title: string; body: string[] } {
  switch (kind) {
    case "terms":
      return { title: "Terms of Use", body: TERMS_OF_USE_BODY };
    case "privacy":
      return { title: "Privacy Notice", body: PRIVACY_NOTICE_BODY };
    case "disclaimer":
      return { title: "Disclaimer", body: DISCLAIMER_BODY };
  }
}

export function LegalLink({ kind, children }: LegalLinkProps) {
  const [open, setOpen] = useState(false);
  const { title, body } = modalCopy(kind);
  return (
    <>
      <button
        type="button"
        className="underline underline-offset-2 hover:text-primary"
        onClick={() => setOpen(true)}
        data-testid={`open-${kind}`}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-amber-600 dark:text-amber-400 font-medium">
              {LEGAL_REVIEW_BANNER}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            {body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
