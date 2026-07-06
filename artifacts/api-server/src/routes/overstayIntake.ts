import { type IRouter, Router } from "express";
import { z } from "zod";
import { or, eq, desc, sql } from "drizzle-orm";
import { db, prelaunchLeadsTable } from "@workspace/db";
import { createRateBucket } from "../lib/rateLimit";
import { normalizeWhatsapp } from "../lib/whatsapp";
import { recordLeadEvent } from "../lib/recordLeadEvent";
import { sanitizeFunnelContext } from "../lib/funnelContext";

const router: IRouter = Router();

const intakeRateLimitByIp = createRateBucket({
  windowMs: 60 * 60 * 1000,
  max: 20,
});

const CURRENT_SITUATION = [
  "visa_expired",
  "undesirable_declaration",
  "overstayed_after_expiry",
  "unsure_of_status",
  "application_rejected_in_sa",
  "missed_departure_deadline",
  "other",
] as const;

const OVERSTAY_DURATION = [
  "lt_30_days",
  "30_to_90_days",
  "gt_90_days",
  "unsure",
] as const;

const YES_NO_UNSURE = ["yes", "no", "unsure"] as const;

const ASSISTANCE_TYPE = [
  "understand_legal_position",
  "overstay_appeal",
  "next_steps_guidance",
  "professional_support",
  "future_visa_planning",
  "general_guidance",
] as const;

const CHALLENGES = [
  "next_steps_unclear",
  "fear_of_ban",
  "communication_difficulty",
  "financial_constraints",
  "delays_uncertainty",
  "lack_of_guidance",
  "stress_anxiety",
  "travel_restrictions",
  "other",
] as const;

const LOCATION = ["inside_sa", "outside_sa"] as const;
const CHANNEL = ["email", "whatsapp", "phone"] as const;

const Body = z.object({
  firstName: z.string().trim().min(1).max(80),
  currentSituation: z.enum(CURRENT_SITUATION),
  location: z.enum(LOCATION),
  overstayDuration: z.enum(OVERSTAY_DURATION),
  submittedApplication: z.enum(YES_NO_UNSURE),
  applicationType: z.string().trim().max(200).optional().nullable(),
  otherSituationDetail: z.string().trim().max(500).optional().nullable(),
  dhaCommunication: z.enum(YES_NO_UNSURE),
  challenges: z.array(z.enum(CHALLENGES)).max(CHALLENGES.length).default([]),
  assistanceType: z.enum(ASSISTANCE_TYPE),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  whatsappOptIn: z.boolean().default(false),
  preferredChannel: z.enum(CHANNEL),
  wantsToUploadDocs: z.boolean().default(false),
  consentAccepted: z.literal(true),
  website: z.string().optional(), // honeypot
});

type IntakeBody = z.infer<typeof Body>;

function generateOverstayRef(): string {
  const year = new Date().getUTCFullYear();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ts = Date.now().toString(36).slice(-3).toUpperCase();
  return `EMA-OVR-${year}-${rand}${ts}`;
}

function computeOverstayScore(data: IntakeBody): {
  score: number;
  tags: string[];
  priority: "critical" | "high" | "medium";
} {
  let score = 0;
  const tags: string[] = ["overstay"];

  // completed assessment
  score += 20;

  // requested assistance (they always do)
  score += 15;

  if (data.whatsappOptIn) {
    score += 10;
    tags.push("overstay_whatsapp_optin");
  }
  if (data.location === "outside_sa") {
    score += 10;
    tags.push("overstay_outside_sa");
  }
  if (data.overstayDuration === "gt_90_days") {
    score += 15;
    tags.push("overstay_gt_90_days");
  } else if (data.overstayDuration === "30_to_90_days") {
    tags.push("overstay_30_90_days");
  }
  if (
    data.challenges.includes("fear_of_ban") ||
    data.challenges.includes("stress_anxiety")
  ) {
    score += 5;
    tags.push("overstay_stress_concerns");
  }
  if (data.currentSituation === "undesirable_declaration") {
    tags.push("overstay_undesirable_declared");
  }
  if (data.wantsToUploadDocs) {
    tags.push("overstay_docs_pending");
  }

  let priority: "critical" | "high" | "medium" = "medium";
  if (score >= 65) priority = "critical";
  else if (score >= 50) priority = "high";

  if (priority !== "medium") tags.push("overstay_high_priority");

  return { score: Math.min(score, 100), tags, priority };
}

function mapImmigrationSituation(s: IntakeBody["currentSituation"]): string {
  switch (s) {
    case "visa_expired":
    case "overstayed_after_expiry":
    case "missed_departure_deadline":
      return "overstay";
    case "undesirable_declaration":
      return "undesirable";
    case "application_rejected_in_sa":
      return "expired";
    case "unsure_of_status":
    case "other":
    default:
      return "unknown";
  }
}

router.post("/overstay-intake", async (req, res) => {
  // Honeypot
  const honey = (req.body as { website?: unknown } | null | undefined)?.website;
  if (typeof honey === "string" && honey.trim().length > 0) {
    return res.status(201).json({
      leadId: "00000000-0000-0000-0000-000000000000",
      referenceNumber: "EMA-OVR-PENDING",
      ok: true,
    });
  }

  const ipDec = intakeRateLimitByIp.hit(req.ip ?? "unknown");
  if (!ipDec.ok) {
    res.setHeader("Retry-After", String(ipDec.retryAfterSec));
    return res
      .status(429)
      .json({ error: "Too many submissions. Please try again later." });
  }

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.issues });
  }
  const data = parsed.data;

  const normalizedWa = data.whatsapp
    ? normalizeWhatsapp(data.whatsapp)
    : data.whatsappOptIn && data.phone
      ? normalizeWhatsapp(data.phone)
      : null;

  // Uniqueness rule: an email or canonical WhatsApp number may only be
  // registered once. A repeat submission is blocked (409) and handed back
  // the existing reference instead of creating a duplicate lead.
  const dupConditions = [
    sql`lower(${prelaunchLeadsTable.email}) = lower(${data.email})`,
  ];
  if (normalizedWa)
    dupConditions.push(eq(prelaunchLeadsTable.whatsapp, normalizedWa));

  const dupRows = await db
    .select({
      id: prelaunchLeadsTable.id,
      referenceNumber: prelaunchLeadsTable.referenceNumber,
    })
    .from(prelaunchLeadsTable)
    .where(or(...dupConditions))
    .orderBy(desc(prelaunchLeadsTable.createdAt))
    .limit(1);

  const existing = dupRows[0];
  if (existing) {
    req.log.info(
      { leadId: existing.id, referenceNumber: existing.referenceNumber },
      "Duplicate overstay submission blocked — already registered",
    );
    return res.status(409).json({
      error: "already_registered",
      message:
        "This email or contact number is already registered with us. We already have your details on file.",
      referenceNumber: existing.referenceNumber,
    });
  }

  const { score, tags, priority } = computeOverstayScore(data);
  const now = new Date();
  const referenceNumber = generateOverstayRef();

  const intakePayload = {
    firstName: data.firstName,
    currentSituation: data.currentSituation,
    location: data.location,
    overstayDuration: data.overstayDuration,
    submittedApplication: data.submittedApplication,
    applicationType: data.applicationType ?? null,
    otherSituationDetail: data.otherSituationDetail ?? null,
    dhaCommunication: data.dhaCommunication,
    challenges: data.challenges,
    assistanceType: data.assistanceType,
    phone: data.phone ?? null,
    whatsappOptIn: data.whatsappOptIn,
    preferredChannel: data.preferredChannel,
    wantsToUploadDocs: data.wantsToUploadDocs,
    submittedAt: now.toISOString(),
  };

  const adminNotes = `[Overstay Intake — ${referenceNumber}]\n${JSON.stringify(
    intakePayload,
    null,
    2,
  )}`;

  let inserted;
  try {
    [inserted] = await db
      .insert(prelaunchLeadsTable)
      .values({
        referenceNumber,
        fullName: data.firstName,
        email: data.email,
        whatsapp: normalizedWa,
        immigrationSituation: mapImmigrationSituation(data.currentSituation),
        currentlyInSouthAfrica: data.location === "inside_sa",
        consentAccepted: true,
        consentTimestamp: now,
        leadType: "individual",
        inquiryType: "overstay_appeal",
        source: "overstay_intake",
        preferredContactMethod: data.preferredChannel,
        leadStatus: "new",
        leadPriority: priority,
        leadScore: score,
        leadCategory:
          priority === "critical"
            ? "High Priority Overstay"
            : priority === "high"
              ? "Priority Overstay Follow-Up"
              : "Overstay Intake",
        internalClassification:
          mapImmigrationSituation(data.currentSituation) === "undesirable"
            ? "undesirable"
            : "overstay",
        tags,
        adminNotes,
        // Phase 3 — funnel route context (route/theme) forwarded by the CTA.
        funnelContext: sanitizeFunnelContext(
          (req.body as { funnelContext?: unknown }).funnelContext,
        ),
      })
      .returning();
  } catch (err) {
    req.log.error({ err }, "Failed to insert overstay intake lead");
    return res.status(500).json({ error: "Failed to record intake" });
  }

  if (!inserted) {
    return res.status(500).json({ error: "Failed to record intake" });
  }

  req.log.info(
    {
      leadId: inserted.id,
      referenceNumber: inserted.referenceNumber,
      score,
      priority,
    },
    "Overstay intake captured",
  );

  // Fire-and-forget scoring events (static rubric — overstay leads have no
  // intendedTier yet). The 60s recompute worker may overwrite leadScore
  // with the static-rubric sum; tags preserve overstay intelligence.
  void recordLeadEvent({
    leadId: inserted.id,
    type: "lead_created",
    source: "system",
  });
  void recordLeadEvent({
    leadId: inserted.id,
    type: "assessment_completed",
    source: "system",
  });

  return res.status(201).json({
    leadId: inserted.id,
    referenceNumber: inserted.referenceNumber,
    priority,
    score,
  });
});

export { router as overstayIntakeRouter };
