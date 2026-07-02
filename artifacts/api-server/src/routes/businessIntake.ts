import { type IRouter, Router } from "express";
import { z } from "zod";
import { or, eq, desc, sql } from "drizzle-orm";
import { db, prelaunchLeadsTable } from "@workspace/db";
import { createRateBucket } from "../lib/rateLimit";
import { normalizeWhatsapp } from "../lib/whatsapp";
import { recordLeadEvent } from "../lib/recordLeadEvent";

const router: IRouter = Router();

const intakeRateLimitByIp = createRateBucket({
  windowMs: 60 * 60 * 1000,
  max: 20,
});

const HEADCOUNT_BAND = ["1-5", "6-20", "21-50", "51+"] as const;

const PRACTICE_AREAS = [
  "work_visas",
  "permanent_residence",
  "appeals",
  "condonation",
  "corporate_mobility",
  "other",
] as const;

const PAIN_TAGS = [
  "backlog",
  "documents",
  "compliance",
  "team",
  "client-experience",
  "ai-readiness",
] as const;

const CASES_BAND = ["<25", "25-99", "100-249", "250+"] as const;

const DURATION_BAND = [
  "<1 month",
  "1-3 months",
  "3-6 months",
  ">6 months",
] as const;

const CHANNEL = ["email", "whatsapp"] as const;

const PainAnswers = z.object({
  backlog: z.string().trim().min(1).max(2000),
  documents: z.string().trim().min(1).max(2000),
  compliance: z.string().trim().min(1).max(2000),
  team: z.string().trim().min(1).max(2000),
  clientExperience: z.string().trim().min(1).max(2000),
});

const Body = z.object({
  // Step 1 — Firm profile
  firmName: z.string().trim().min(1).max(160),
  countryHq: z.string().trim().min(1).max(120),
  headcountBand: z.enum(HEADCOUNT_BAND),
  yearsOperating: z.number().int().min(0).max(200),
  // Step 2 — Coverage
  practiceAreas: z
    .array(z.enum(PRACTICE_AREAS))
    .min(1)
    .max(PRACTICE_AREAS.length),
  multiJurisBeyondZa: z.boolean(),
  jurisdictions: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  // Step 3 — Decision-maker
  decisionMakerTech: z.boolean(),
  roleOfDecisionMaker: z.string().trim().max(200).optional().nullable(),
  // Step 4 — Pain questions
  painAnswers: PainAnswers,
  painTags: z.array(z.enum(PAIN_TAGS)).max(PAIN_TAGS.length).default([]),
  // Step 5 — Volume
  casesLast12mBand: z.enum(CASES_BAND),
  pctCrossBorder: z.number().int().min(0).max(100),
  typicalDurationBand: z.enum(DURATION_BAND),
  // Step 6 — Contact
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  preferredChannel: z.enum(CHANNEL),
  city: z.string().trim().max(120).optional().nullable(),
  provinceState: z.string().trim().max(120).optional().nullable(),
  countryOfResidence: z.string().trim().max(120).optional().nullable(),
  consentAccepted: z.literal(true),
  website: z.string().optional(), // honeypot
}).superRefine((data, ctx) => {
  // Conditional requireds — enforced server-side so a direct API call can't
  // create an incomplete business lead by bypassing the frontend gates.
  if (data.multiJurisBeyondZa && data.jurisdictions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["jurisdictions"],
      message: "Select at least one jurisdiction.",
    });
  }
  if (
    !data.decisionMakerTech &&
    !(data.roleOfDecisionMaker && data.roleOfDecisionMaker.trim().length > 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["roleOfDecisionMaker"],
      message: "The role of the decision-maker is required.",
    });
  }
});

type IntakeBody = z.infer<typeof Body>;

type BusinessTier = "strategic" | "hot" | "warm";

function generateBusinessRef(): string {
  const year = new Date().getUTCFullYear();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ts = Date.now().toString(36).slice(-3).toUpperCase();
  return `EMA-BUS-${year}-${rand}${ts}`;
}

// Spec §4 classifier (funnel_three_segments_v2). The 5 pain questions are the
// centre of gravity: 3+ confirmed pain tags flips a lead to "hot".
function classifyBusiness(data: IntakeBody): BusinessTier {
  const big =
    data.headcountBand === "21-50" || data.headcountBand === "51+";
  if (big && data.multiJurisBeyondZa) return "strategic";
  if (data.painTags.length >= 3) return "hot";
  return "warm";
}

function computeBusinessScore(
  data: IntakeBody,
  tier: BusinessTier,
): { score: number; tags: string[]; priority: "critical" | "high" | "medium" } {
  let score = 25; // completed the assessment
  const tags: string[] = ["business", `business_tier_${tier}`];

  const big =
    data.headcountBand === "21-50" || data.headcountBand === "51+";
  if (big) {
    score += 15;
    tags.push("business_large_firm");
  }
  if (data.multiJurisBeyondZa) {
    score += 10;
    tags.push("business_multi_juris");
  }
  if (data.decisionMakerTech) {
    score += 10;
    tags.push("business_decision_maker");
  }
  if (data.painTags.length >= 3) {
    score += 15;
    tags.push("business_pain_confirmed");
  } else if (data.painTags.length >= 1) {
    score += 5;
  }
  if (data.pctCrossBorder >= 50) {
    score += 10;
    tags.push("business_cross_border_heavy");
  }
  if (
    data.casesLast12mBand === "100-249" ||
    data.casesLast12mBand === "250+"
  ) {
    score += 15;
    tags.push("business_high_volume");
  } else if (data.casesLast12mBand === "25-99") {
    score += 5;
  }
  if (data.practiceAreas.includes("corporate_mobility")) {
    score += 5;
    tags.push("business_corporate_mobility");
  }

  // Merge the rep-facing pain tags so the drawer can render them directly.
  for (const t of data.painTags) tags.push(`pain_${t.replace(/-/g, "_")}`);

  const priority: "critical" | "high" | "medium" =
    tier === "strategic" ? "critical" : tier === "hot" ? "high" : "medium";

  return { score: Math.min(score, 100), tags, priority };
}

// Representative integer for the B2B "estimated client volume" column so the
// admin contact-intelligence card has a number to show; the exact band is
// preserved verbatim in adminNotes.
function bandToEstimatedVolume(band: IntakeBody["casesLast12mBand"]): number {
  switch (band) {
    case "<25":
      return 12;
    case "25-99":
      return 60;
    case "100-249":
      return 175;
    case "250+":
      return 300;
    default:
      return 0;
  }
}

router.post("/business-intake", async (req, res) => {
  // Honeypot
  const honey = (req.body as { website?: unknown } | null | undefined)?.website;
  if (typeof honey === "string" && honey.trim().length > 0) {
    return res.status(201).json({
      leadId: "00000000-0000-0000-0000-000000000000",
      referenceNumber: "EMA-BUS-PENDING",
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
      "Duplicate business submission blocked — already registered",
    );
    return res.status(409).json({
      error: "already_registered",
      message:
        "This email or contact number is already registered with us. We already have your details on file.",
      referenceNumber: existing.referenceNumber,
    });
  }

  const tier = classifyBusiness(data);
  const { score, tags, priority } = computeBusinessScore(data, tier);
  const now = new Date();
  const referenceNumber = generateBusinessRef();

  const intakePayload = {
    firm: {
      name: data.firmName,
      countryHq: data.countryHq,
      headcountBand: data.headcountBand,
      yearsOperating: data.yearsOperating,
    },
    practiceAreas: data.practiceAreas,
    multiJurisBeyondZa: data.multiJurisBeyondZa,
    jurisdictions: data.multiJurisBeyondZa ? data.jurisdictions : [],
    decisionMakerTech: data.decisionMakerTech,
    roleOfDecisionMaker: data.decisionMakerTech
      ? null
      : (data.roleOfDecisionMaker ?? null),
    painAnswers: data.painAnswers,
    painTags: data.painTags,
    volume: {
      casesLast12mBand: data.casesLast12mBand,
      pctCrossBorder: data.pctCrossBorder,
      typicalDurationBand: data.typicalDurationBand,
    },
    contact: {
      fullName: data.fullName,
      email: data.email,
      whatsapp: data.whatsapp ?? null,
      preferredChannel: data.preferredChannel,
      city: data.city ?? null,
      provinceState: data.provinceState ?? null,
      countryOfResidence: data.countryOfResidence ?? null,
    },
    tier,
    submittedAt: now.toISOString(),
  };

  const adminNotes = `[Business Intake — ${referenceNumber}] tier=${tier}\n${JSON.stringify(
    intakePayload,
    null,
    2,
  )}`;

  const leadCategory =
    tier === "strategic"
      ? "Strategic Firm Account"
      : tier === "hot"
        ? "High-Intent Firm"
        : "Firm Enquiry";

  const operatingRegions = data.multiJurisBeyondZa
    ? data.jurisdictions
    : [];

  let inserted;
  try {
    [inserted] = await db
      .insert(prelaunchLeadsTable)
      .values({
        referenceNumber,
        fullName: data.fullName,
        email: data.email,
        whatsapp: normalizedWa,
        countryOfResidence: data.countryOfResidence ?? null,
        currentlyInSouthAfrica:
          (data.countryOfResidence ?? "").trim().toUpperCase() === "ZA" ||
          data.countryHq.trim().toUpperCase() === "ZA",
        consentAccepted: true,
        consentTimestamp: now,
        leadType: "professional",
        source: "business_intake",
        preferredContactMethod: data.preferredChannel,
        leadStatus: "new",
        leadPriority: priority,
        leadScore: score,
        leadCategory,
        internalClassification: "business",
        tags,
        adminNotes,
        // ── B2B contact-intelligence columns ──────────────────────────────
        organizationName: data.firmName,
        representativeName: data.fullName,
        representativeEmail: data.email,
        representativePhone: normalizedWa,
        representativeRole: data.decisionMakerTech
          ? "Decision-Maker (Technology / Systems)"
          : (data.roleOfDecisionMaker ?? null),
        representativeRelationship: data.decisionMakerTech
          ? "Primary Decision Maker"
          : "Departmental Contact",
        firmSize: data.headcountBand,
        operatingRegions,
        serviceFocus:
          data.practiceAreas.length > 0
            ? data.practiceAreas.join(", ")
            : null,
        estimatedClientVolume: bandToEstimatedVolume(data.casesLast12mBand),
      })
      .returning();
  } catch (err) {
    req.log.error({ err }, "Failed to insert business intake lead");
    return res.status(500).json({ error: "Failed to record intake" });
  }

  if (!inserted) {
    return res.status(500).json({ error: "Failed to record intake" });
  }

  req.log.info(
    {
      leadId: inserted.id,
      referenceNumber: inserted.referenceNumber,
      tier,
      score,
      priority,
    },
    "Business intake captured",
  );

  // Fire-and-forget scoring events (static rubric — professional intake has no
  // intendedTier yet). The 60s recompute worker may overwrite leadScore with
  // the static-rubric sum; tags preserve business intelligence.
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
    tier,
    priority,
    score,
  });
});

export { router as businessIntakeRouter };
