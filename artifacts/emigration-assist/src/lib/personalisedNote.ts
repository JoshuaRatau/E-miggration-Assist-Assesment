export interface PersonalisedNoteInput {
  fullName?: string | null;
  immigrationSituation?: string | null;
  passportStatus?: string | null;
  currentlyInSouthAfrica?: boolean | null;
  hasSupportingDocuments?: string | null;
  documentsUploaded?: number;
}

export interface PersonalisedNote {
  greeting: string;
  headline: string;
  body: string[];
  nextStep: string;
}

const SITUATION_HEADLINE: Record<string, string> = {
  valid: "Your status appears to be in good standing.",
  expired: "Your visa appears to need urgent attention.",
  overstay:
    "Your situation requires careful review of supporting circumstances.",
  undesirable:
    "Your matter involves a declared undesirable status — specialist review is needed.",
  prohibited:
    "Your matter may involve a prohibited-person classification — specialist review is needed.",
  visa_required: "You appear to need a visa or new visa application.",
  unknown: "Your situation will need a closer look by our team.",
};

function firstName(fullName: string | null | undefined): string | null {
  if (typeof fullName !== "string") return null;
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return null;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/**
 * Pure, rules-based personalised summary used on the final assessment
 * step and on /thank-you. Intentionally hedged language only — never
 * states an outcome, never promises an action by Home Affairs, never
 * uses any of the forbidden phrases enforced server-side in
 * `findForbiddenPhrase` (lib/email.ts).
 */
export function buildPersonalisedNote(
  input: PersonalisedNoteInput,
): PersonalisedNote {
  const name = firstName(input.fullName);
  const greeting = name ? `Hello ${name},` : "Hello,";

  const headline =
    SITUATION_HEADLINE[input.immigrationSituation ?? ""] ??
    "Your information has been recorded for review.";

  const body: string[] = [];

  body.push(
    "Your information has been securely captured. The assessment below is a preliminary, system-generated indication only — not a final determination.",
  );

  if (input.currentlyInSouthAfrica === true) {
    body.push(
      "You indicated you are currently inside South Africa. Where time-sensitive next steps apply, our team will flag them clearly when they reach out.",
    );
  } else if (input.currentlyInSouthAfrica === false) {
    body.push(
      "You indicated you are currently outside South Africa. Cross-border options will be considered as part of your case review.",
    );
  }

  switch (input.passportStatus) {
    case "expired":
      body.push(
        "Your passport is expiring soon — renewing it early gives the most flexibility for whichever path is recommended.",
      );
      break;
    case "none":
      body.push(
        "You indicated you do not currently hold a passport. A valid passport is generally required before a formal application can proceed.",
      );
      break;
    case "unsure":
      body.push(
        "You were unsure about your passport status. Our team will help you confirm validity during follow-up.",
      );
      break;
    default:
      break;
  }

  if (input.hasSupportingDocuments === "no") {
    body.push(
      "You have not yet provided supporting documents. Where relevant, having these ready (medical letters, employer notes, family-tie evidence) tends to make case review faster and more accurate.",
    );
  } else if (input.hasSupportingDocuments === "some") {
    body.push(
      "You provided partial supporting documents. Our team will let you know if anything additional would strengthen the picture.",
    );
  }

  if (typeof input.documentsUploaded === "number" && input.documentsUploaded > 0) {
    body.push(
      `You uploaded ${input.documentsUploaded} document${input.documentsUploaded === 1 ? "" : "s"} — they are linked privately to your reference and will be reviewed alongside the rest of your case.`,
    );
  }

  let nextStep = "A consultant will be in touch using your preferred contact channel.";
  switch (input.immigrationSituation) {
    case "expired":
    case "overstay":
      nextStep =
        "A consultant will reach out shortly to discuss the time-sensitive aspects of your case.";
      break;
    case "undesirable":
    case "prohibited":
      nextStep =
        "A senior consultant will reach out personally — these matters are handled with extra care.";
      break;
    case "visa_required":
      nextStep =
        "A consultant will be in touch to walk through the visa pathways available for your situation.";
      break;
    default:
      break;
  }

  return { greeting, headline, body, nextStep };
}
