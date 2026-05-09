import { useState } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Check,
  Sparkles,
  Info,
  Crown,
  Building2,
  Plane,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Plug,
  DollarSign,
  Users,
  TrendingUp,
  AlertCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Subscriptions page — visual preview of the planned pricing structure.
//
// No data is captured yet (Phase 7 will add real billing). This page exists
// purely so operators and stakeholders can see the proposed tier structure
// inside the admin chrome, inspired by the Clio "Business of law / Practice
// of law" pricing layout. All copy is sourced from
// `attached_assets/E-Migration_Assist_–_Pricing_&_Package_Structure_v3...pdf`.

type Tier = {
  name: string;
  price: string;
  priceSub?: string;
  blurb: string;
  positioning: string;
  features: string[];
  benefits?: string[];
  cta: string;
  highlight?: "popular" | "best-value" | "premium";
};

const TRAVELLER_TIERS: Tier[] = [
  {
    name: "Free",
    price: "R0",
    priceSub: "forever",
    blurb: "Explore visa options and see how the process works.",
    positioning: "Free entry experience",
    features: [
      "Account creation",
      "Basic visa exploration",
      "Guided intake",
      "Rules-based eligibility direction",
      "Limited checklist preview",
      "Limited profile creation",
      "View-only experience of the process",
    ],
    cta: "Current default",
  },
  {
    name: "Basic",
    price: "From R99",
    priceSub: "per month",
    blurb: "Accessible entry point for simple applications.",
    positioning: "Accessible entry point for simple applications",
    features: [
      "Full guided application flow",
      "Full checklist access",
      "Document uploads",
      "Progress tracking & reminders",
      "Basic notifications",
      "One active application or appeal draft",
    ],
    benefits: [
      "Knowledge base access",
      "Step-by-step system prompts",
      "Community-level support",
    ],
    cta: "Plan",
  },
  {
    name: "Plus",
    price: "R249",
    priceSub: "per month",
    blurb: "Reassurance and light expert input when you need it.",
    positioning: "Users needing reassurance and light expert input",
    features: [
      "Richer document handling",
      "Readiness indicators",
      "Detailed compliance prompts",
      "Timeline visibility",
      "Better notification coverage",
      "Limited draft generation / AI actions",
    ],
    benefits: [
      "Priority support",
      "Monthly group advisory session (Q&A)",
      "System review prompts (error flags)",
    ],
    cta: "Plan",
    highlight: "popular",
  },
  {
    name: "Pro",
    price: "R599 – R1,200",
    priceSub: "per month",
    blurb: "Assurance for high-stakes or complex applications.",
    positioning: "High-stakes or complex applications requiring assurance",
    features: [
      "AI-assisted drafting (where enabled)",
      "Deeper risk explanation",
      "Stronger document readiness support",
      "Premium support queue",
      "One consultation / review touchpoint",
      "Overstay appeal support (where plan rules allow)",
    ],
    benefits: [
      "Limited dedicated consultation (1 per month / milestone)",
      "Pre-submission review support",
    ],
    cta: "Plan",
  },
  {
    name: "Premium",
    price: "R1,200 – R1,500",
    priceSub: "per month",
    blurb: "Personal touch added to every milestone.",
    positioning: "High-end clients adding a personal touch to each milestone",
    features: [
      "Everything in Pro",
      "Maximum storage",
    ],
    benefits: [
      "Dedicated consultation (4 per month / milestone)",
      "Priority case guidance",
      "Escalation to Premium queue",
    ],
    cta: "Plan",
    highlight: "best-value",
  },
];

const FIRM_TIERS: Tier[] = [
  {
    name: "Free",
    price: "R0",
    priceSub: "per user / month",
    blurb: "Explore the platform with view-only access.",
    positioning: "Free professional preview",
    features: [
      "Account creation",
      "Basic visa exploration",
      "Guided intake",
      "Rules-based eligibility direction",
      "Limited checklist preview",
      "Limited profile creation",
      "View-only experience",
    ],
    cta: "Plan",
  },
  {
    name: "Starter Firm",
    price: "R850",
    priceSub: "per user / month",
    blurb: "Entry-level structure for small / boutique practices.",
    positioning: "≤ 10 cases / month",
    features: [
      "Firm dashboard",
      "Client CRM",
      "Case creation",
      "Basic checklist generation",
      "Tasks, notes, timeline",
      "Standard tracking & notifications",
      "Limited AI actions",
      "Limited document intelligence",
    ],
    benefits: [
      "Onboarding Lite (guided setup)",
      "Email support (24–48h SLA)",
      "Pre-configured templates",
      "Monthly system tips",
    ],
    cta: "Plan",
  },
  {
    name: "Growth Firm",
    price: "R1,600",
    priceSub: "per user / month",
    blurb: "Scaling firms needing efficiency and consistency.",
    positioning: "10–20 cases / month",
    features: [
      "Stronger workflow tools",
      "Client communication features",
      "More AI copilot actions",
      "More OCR / document intelligence",
      "Better reporting",
      "Automation features (where enabled)",
      "Broader team use",
    ],
    benefits: [
      "1-on-1 tailored setup assistance",
      "Priority support (12–24h SLA)",
      "Client workflow optimisation",
      "Quarterly workflow review",
    ],
    cta: "Plan",
    highlight: "popular",
  },
  {
    name: "Scale Firm",
    price: "R2,800",
    priceSub: "per user / month",
    blurb: "High-volume firms requiring full operational control.",
    positioning: "20+ cases / month",
    features: [
      "High / fair-use case volumes",
      "Advanced workflow automation",
      "Full copilot access",
      "Advanced reporting",
      "Priority processing",
      "Stronger admin controls",
      "Best support level",
    ],
    benefits: [
      "Dedicated account support",
      "Fast-track support (<12h SLA)",
      "Advanced workflow customisation",
      "Monthly performance reviews",
      "Early feature access",
    ],
    cta: "Plan",
    highlight: "best-value",
  },
  {
    name: "Enterprise",
    price: "Custom",
    priceSub: "tailored to scope",
    blurb: "Large firms and corporates with bespoke requirements.",
    positioning: "Large firms / corporates",
    features: [
      "Custom onboarding",
      "Custom support",
      "Custom workflow configurations",
      "Advanced seats & permissions",
      "Possible future API / integration layer",
      "Premium SLA",
      "Data migration & deployment support",
    ],
    benefits: [
      "Custom onboarding team",
      "Integration support",
      "Advanced reporting",
      "SLA-based support",
    ],
    cta: "Contact sales",
  },
];

const CONCIERGE_TIER: Tier = {
  name: "Premium Concierge",
  price: "R45,000 – R250,000+",
  priceSub: "depending on category, complexity & service depth",
  blurb: "Private, white-glove immigration execution.",
  positioning:
    "Investors · financially independent permits · business visas · executive relocations · HNW or time-poor clients",
  features: [
    "Investor visa execution",
    "Financially independent permits",
    "Business visa execution",
    "Executive relocations",
    "High-net-worth & time-poor handling",
  ],
  benefits: [
    "Dedicated specialist",
    "Proactive updates",
    "Minimal client involvement",
    "Full accountability",
  ],
  cta: "Engage concierge",
  highlight: "premium",
};

const TRIAL_NOTES = [
  {
    audience: "Travellers (B2C)",
    body: "No generic 14-day trial. Use a guided free experience: free onboarding, free exploration, free checklist preview, and free initial document staging. Lock advanced AI, full readiness support, submission guidance, and premium workflows so users experience value first and upgrade at the point of trust.",
  },
  {
    audience: "Firms (B2B)",
    body: "Controlled 14-day pilot trial — full access to the core portal, but limit case volume, exports, and high-cost AI/OCR consumption. Include onboarding support so firms experience the operational benefit before purchase without turning the trial into a free production environment.",
  },
];

const PRICING_RATIONALE = [
  "Rules engine controls valid categories and case-type logic",
  "Document intelligence with OCR / classification / verification",
  "AI copilot actions: summaries, blockers, missing-document requests, motivation letters, risk explanations",
  "Multi-tenant firm workflows",
  "Background jobs, notifications, audit events, and entitlements",
];

export function AdminSubscriptions() {
  const [tab, setTab] = useState<"travellers" | "firms" | "concierge">(
    "travellers",
  );
  // Pricing & packages defaults to hidden so the live-data section above
  // owns the visual hierarchy. The reveal toggle is intentionally large
  // and friendly so operators don't miss it.
  const [showPricing, setShowPricing] = useState(false);

  return (
    <AdminLayout
      title="Subscription Management"
      bodyClassName="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100"
      contentClassName="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 pt-6 pb-16"
    >
      <div className="space-y-8">
        {/* ---------------------------------------------------------- */}
        {/* SECTION 1 — Page header + Phase 7 webhook-awaiting notice    */}
        {/* ---------------------------------------------------------- */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">
                Billing & Revenue
              </p>
              <h1
                className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight"
                data-testid="page-title-subscriptions"
              >
                Subscription Management
              </h1>
              <p className="mt-1 text-sm text-slate-400 max-w-2xl">
                Customer subscriptions, payments, and revenue intelligence
                will land in this workspace once the billing provider is
                connected.
              </p>
            </div>
            <Badge
              variant="outline"
              className="border-amber-300/40 bg-amber-500/10 text-amber-200 gap-1.5"
              data-testid="badge-phase-7"
            >
              <Plug className="h-3 w-3" />
              Phase 7 — webhook integration pending
            </Badge>
          </div>

          {/* Webhook-awaiting notice — explicit about external dependency. */}
          <div
            className="rounded-xl border border-sky-300/30 bg-sky-500/10 p-4 text-sm text-sky-100 flex items-start gap-3"
            data-testid="banner-webhook-pending"
          >
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">
                Awaiting webhook integration from the external billing
                provider.
              </p>
              <p className="text-sky-200/80">
                As part of <strong>Phase 7</strong>, this workspace will be
                wired to receive subscription, invoice, and payment events
                from the payment provider (Paystack / Stripe). Once those
                webhooks are live, the panels below will populate automatically
                with active subscriptions, revenue, churn, and per-customer
                billing history. Until then, no customer payments are
                captured.
              </p>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* SECTION 2 — Live subscription data (placeholder until P7)   */}
        {/* ---------------------------------------------------------- */}
        <Card className="border-slate-700/40 bg-slate-900/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-teal-300" />
              <CardTitle className="text-base">
                Active subscriptions & revenue
              </CardTitle>
            </div>
            <CardDescription className="text-slate-400">
              Real customer subscription and cost data will appear here once
              webhooks from the billing provider are connected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <PlaceholderTile
                icon={<Users className="h-4 w-4" />}
                label="Active subscribers"
              />
              <PlaceholderTile
                icon={<DollarSign className="h-4 w-4" />}
                label="Monthly recurring revenue"
              />
              <PlaceholderTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Net new this month"
              />
              <PlaceholderTile
                icon={<AlertCircle className="h-4 w-4" />}
                label="At-risk / past due"
              />
            </div>
            <p className="mt-4 text-xs text-slate-500 text-center">
              No customer billing data captured yet — values will populate
              automatically once Phase 7 ships.
            </p>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* SECTION 3 — Pricing & Packages (collapsible reference)      */}
        {/* ---------------------------------------------------------- */}
        <Card
          className="border-slate-700/40 bg-slate-900/40 overflow-hidden"
          data-testid="section-pricing-packages"
        >
          <button
            type="button"
            onClick={() => setShowPricing((v) => !v)}
            className="w-full text-left p-5 hover:bg-slate-800/30 transition-colors flex items-center justify-between gap-4"
            data-testid="toggle-pricing-packages"
            aria-expanded={showPricing}
            aria-controls="pricing-packages-content"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-teal-500/15 p-2 text-teal-300">
                <Briefcase className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">
                  Reference
                </p>
                <h2 className="text-base font-semibold tracking-tight">
                  Pricing & Package Structure
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Proposed tier model for travellers, firms, and concierge
                  clients. Internal alignment only — not shown to customers.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300 flex-shrink-0">
              <span className="hidden sm:inline">
                {showPricing ? "Hide structure" : "Reveal structure"}
              </span>
              {showPricing ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </button>

          {showPricing && (
            <div
              id="pricing-packages-content"
              className="border-t border-slate-700/40 p-5 sm:p-6 space-y-8"
              data-testid="pricing-packages-content"
            >
              <div className="text-center max-w-3xl mx-auto">
                <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                  Built for travellers, firms, and concierge clients.
                </h3>
                <p className="mt-3 text-sm text-slate-400">
                  Choose the audience to preview pricing. Each tier is
                  designed around real product capability — rules engine,
                  document intelligence, copilot actions, and firm-grade
                  workflows.
                </p>
              </div>

              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as typeof tab)}
              >
                <div className="flex justify-center">
                  <TabsList
                    className="bg-slate-900/60 border border-slate-700/40 p-1"
                    data-testid="tabs-audience"
                  >
                    <TabsTrigger
                      value="travellers"
                      className="data-[state=active]:bg-teal-500/20 data-[state=active]:text-teal-200 px-4 sm:px-6"
                      data-testid="tab-travellers"
                    >
                      <Plane className="mr-2 h-4 w-4" />
                      Individual Travellers
                    </TabsTrigger>
                    <TabsTrigger
                      value="firms"
                      className="data-[state=active]:bg-teal-500/20 data-[state=active]:text-teal-200 px-4 sm:px-6"
                      data-testid="tab-firms"
                    >
                      <Building2 className="mr-2 h-4 w-4" />
                      Professionals & Firms
                    </TabsTrigger>
                    <TabsTrigger
                      value="concierge"
                      className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-200 px-4 sm:px-6"
                      data-testid="tab-concierge"
                    >
                      <Crown className="mr-2 h-4 w-4" />
                      Premium Concierge
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="travellers" className="mt-8">
                  <PricingGrid tiers={TRAVELLER_TIERS} kind="b2c" />
                </TabsContent>
                <TabsContent value="firms" className="mt-8">
                  <PricingGrid tiers={FIRM_TIERS} kind="b2b" />
                </TabsContent>
                <TabsContent value="concierge" className="mt-8">
                  <ConciergeCard tier={CONCIERGE_TIER} />
                </TabsContent>
              </Tabs>

              <div className="grid gap-6 md:grid-cols-2 pt-4">
                <Card className="border-slate-700/40 bg-slate-900/60">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-teal-300" />
                      <CardTitle className="text-base">
                        Recommended trial model
                      </CardTitle>
                    </div>
                    <CardDescription className="text-slate-400">
                      How users and firms experience the platform before
                      committing.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {TRIAL_NOTES.map((note) => (
                      <div key={note.audience} className="space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wider text-teal-300/80">
                          {note.audience}
                        </p>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          {note.body}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-slate-700/40 bg-slate-900/60">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-teal-300" />
                      <CardTitle className="text-base">
                        Why this pricing fits the product
                      </CardTitle>
                    </div>
                    <CardDescription className="text-slate-400">
                      The model is justified by what the system actually
                      delivers.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="space-y-2">
                      {PRICING_RATIONALE.map((line) => (
                        <li
                          key={line}
                          className="flex items-start gap-2 text-sm text-slate-300"
                        >
                          <Check className="h-4 w-4 text-teal-300 mt-0.5 flex-shrink-0" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-slate-500 pt-2 border-t border-slate-700/40">
                      Pricing remains realistic — the team has flagged
                      ongoing work on AI document review reliability,
                      communications, broader visa coverage, client editing,
                      eligibility-assessment depth, and task-automation
                      maturity.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}

// Empty-state tile for the live-revenue section. Renders an em-dash where a
// real number will eventually live, plus a neutral icon so the grid has
// visual weight even with no data.
function PlaceholderTile({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/60 p-3">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-500">
        —
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">
        Awaiting webhook
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing grid — Clio-inspired cards. The "highlight" tier gets a glow ring
// and a top-mounted badge.

function PricingGrid({ tiers, kind }: { tiers: Tier[]; kind: "b2c" | "b2b" }) {
  return (
    <div
      className="grid gap-5 md:grid-cols-2 xl:grid-cols-5"
      data-testid={`pricing-grid-${kind}`}
    >
      {tiers.map((tier) => (
        <PricingCard key={tier.name} tier={tier} />
      ))}
    </div>
  );
}

function PricingCard({ tier }: { tier: Tier }) {
  const isPopular = tier.highlight === "popular";
  const isBest = tier.highlight === "best-value";
  const ringClass = isPopular
    ? "ring-2 ring-teal-400/60 shadow-[0_0_40px_-10px_rgba(45,212,191,0.4)]"
    : isBest
      ? "ring-2 ring-emerald-400/50 shadow-[0_0_40px_-10px_rgba(52,211,153,0.35)]"
      : "ring-1 ring-slate-700/40";
  const bgClass = isPopular || isBest ? "bg-slate-900/80" : "bg-slate-900/50";

  return (
    <div
      className={`relative rounded-xl border border-slate-700/40 ${bgClass} ${ringClass} p-5 flex flex-col`}
      data-testid={`tier-${tier.name.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {isPopular ? (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-500 text-slate-950 hover:bg-teal-400 border-0">
          Popular
        </Badge>
      ) : null}
      {isBest ? (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-0">
          Best value
        </Badge>
      ) : null}

      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-slate-100">{tier.name}</h3>
        <p className="text-xs text-slate-400 leading-snug min-h-[2.5rem]">
          {tier.positioning}
        </p>
      </div>

      <div className="mt-4 pb-4 border-b border-slate-700/40">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tracking-tight text-slate-100">
            {tier.price}
          </span>
          {tier.priceSub ? (
            <span className="text-xs text-slate-400">{tier.priceSub}</span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-300 leading-snug">
          {tier.blurb}
        </p>
      </div>

      <div className="mt-4 flex-1 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
            Core features
          </p>
          <ul className="space-y-1.5">
            {tier.features.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-xs text-slate-300"
              >
                <Check className="h-3.5 w-3.5 text-teal-300 mt-0.5 flex-shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        {tier.benefits ? (
          <div className="pt-3 border-t border-slate-800">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
              Differentiators
            </p>
            <ul className="space-y-1.5">
              {tier.benefits.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-2 text-xs text-slate-400"
                >
                  <Sparkles className="h-3 w-3 text-amber-300/80 mt-0.5 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Button
        variant={isPopular || isBest ? "default" : "outline"}
        size="sm"
        disabled
        className={`mt-5 w-full ${
          isPopular
            ? "bg-teal-500 text-slate-950 hover:bg-teal-400 border-0"
            : isBest
              ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-0"
              : "border-slate-600 text-slate-300"
        }`}
        data-testid={`button-tier-${tier.name.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {tier.cta}
      </Button>
    </div>
  );
}

function ConciergeCard({ tier }: { tier: Tier }) {
  return (
    <div className="max-w-3xl mx-auto">
      <div
        className="relative rounded-2xl border border-amber-300/30 bg-gradient-to-br from-slate-900/80 via-amber-950/20 to-slate-900/80 p-8 ring-1 ring-amber-300/20 shadow-[0_0_60px_-15px_rgba(251,191,36,0.25)]"
        data-testid="tier-concierge"
      >
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-950 hover:bg-amber-300 border-0">
          <Crown className="mr-1 h-3 w-3" />
          White-glove
        </Badge>

        <div className="text-center">
          <h3 className="text-2xl font-semibold text-slate-100">
            {tier.name}
          </h3>
          <p className="mt-2 text-sm text-amber-200/80">{tier.positioning}</p>
          <div className="mt-5 flex items-baseline justify-center gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-100">
              {tier.price}
            </span>
          </div>
          {tier.priceSub ? (
            <p className="mt-1 text-xs text-slate-400">{tier.priceSub}</p>
          ) : null}
          <p className="mt-4 text-sm text-slate-300 max-w-xl mx-auto">
            {tier.blurb}
          </p>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-amber-300/80 mb-3">
              Core offering
            </p>
            <ul className="space-y-2">
              {tier.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-slate-300"
                >
                  <Check className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-amber-300/80 mb-3">
              Additional benefits
            </p>
            <ul className="space-y-2">
              {tier.benefits?.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-2 text-sm text-slate-300"
                >
                  <Sparkles className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Button
            disabled
            className="bg-amber-400 text-slate-950 hover:bg-amber-300 border-0"
            data-testid="button-tier-concierge"
          >
            <Crown className="mr-2 h-4 w-4" />
            {tier.cta}
          </Button>
        </div>
      </div>
    </div>
  );
}
