import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BrandHeader } from "@/components/brand-header";
import { Check, Plane, Building2, ArrowRight } from "lucide-react";

type Tier = {
  name: string;
  badge?: string;
  highlight?: boolean;
  tagline: string;
  price: string;
  priceSuffix?: string;
  blurb: string;
  core: string[];
  diff?: string[];
  cta: string;
};

const travellerTiers: Tier[] = [
  {
    name: "Free",
    tagline: "Free entry experience",
    price: "R0",
    priceSuffix: "forever",
    blurb: "Explore visa options and see how the process works.",
    core: [
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
    tagline: "Accessible entry point for simple applications",
    price: "From R99",
    priceSuffix: "per month",
    blurb: "Accessible entry point for simple applications.",
    core: [
      "Full guided application flow",
      "Full checklist access",
      "Document uploads",
      "Progress tracking & reminders",
      "Basic notifications",
      "One active application or appeal draft",
    ],
    diff: [
      "Knowledge base access",
      "Step-by-step system prompts",
      "Community-level support",
    ],
    cta: "Plan",
  },
  {
    name: "Plus",
    badge: "Popular",
    highlight: true,
    tagline: "Users needing reassurance and light expert input",
    price: "R249",
    priceSuffix: "per month",
    blurb: "Reassurance and light expert input when you need it.",
    core: [
      "Richer document handling",
      "Readiness indicators",
      "Detailed compliance prompts",
      "Timeline visibility",
      "Better notification coverage",
      "Limited draft generation / AI actions",
    ],
    diff: [
      "Priority support",
      "Monthly group advisory session (Q&A)",
      "System review prompts (error flags)",
    ],
    cta: "Plan",
  },
  {
    name: "Pro",
    tagline: "High-stakes or complex applications requiring assurance",
    price: "R599 – R1,200",
    priceSuffix: "per month",
    blurb: "Assurance for high-stakes or complex applications.",
    core: [
      "AI-assisted drafting (where enabled)",
      "Deeper risk explanation",
      "Stronger document readiness support",
      "Premium support queue",
      "One consultation / review touchpoint",
      "Overstay appeal support (where plan rules allow)",
    ],
    diff: [
      "Limited dedicated consultation (1 per month / milestone)",
      "Pre-submission review support",
    ],
    cta: "Plan",
  },
  {
    name: "Premium",
    badge: "Best value",
    highlight: true,
    tagline: "High-end clients adding a personal touch to each milestone",
    price: "R1,200 – R1,500",
    priceSuffix: "per month",
    blurb: "Personal touch added to every milestone.",
    core: ["Everything in Pro", "Maximum storage"],
    diff: [
      "Dedicated consultation (4 per month / milestone)",
      "Priority case guidance",
      "Escalation to Premium queue",
    ],
    cta: "Plan",
  },
];

// Placeholder until the user pastes the Firms tier list.
const firmTiers: Tier[] = [];

function TierCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
        tier.highlight
          ? "border-teal-400/60 bg-slate-900/80 shadow-[0_0_0_1px_rgba(45,212,191,0.25),0_20px_50px_-20px_rgba(45,212,191,0.35)]"
          : "border-white/10 bg-slate-900/60"
      }`}
      data-testid={`pricing-tier-${tier.name.toLowerCase()}`}
    >
      {tier.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              tier.badge === "Best value"
                ? "bg-emerald-400 text-slate-900 hover:bg-emerald-400"
                : "bg-slate-800 text-teal-300 ring-1 ring-teal-400/40 hover:bg-slate-800"
            }`}
          >
            {tier.badge}
          </Badge>
        </div>
      )}

      <div className="space-y-1">
        <h3 className="text-xl font-semibold text-white">{tier.name}</h3>
        <p className="text-xs text-slate-400">{tier.tagline}</p>
      </div>

      <div className="mt-6 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{tier.price}</span>
        {tier.priceSuffix && (
          <span className="text-xs text-slate-400">{tier.priceSuffix}</span>
        )}
      </div>

      <p className="mt-4 text-sm text-slate-300">{tier.blurb}</p>

      <div className="mt-6 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Core features
        </p>
        <ul className="space-y-2">
          {tier.core.map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-slate-300">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-teal-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {tier.diff && tier.diff.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Differentiators
          </p>
          <ul className="space-y-2">
            {tier.diff.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-xs text-slate-300"
              >
                <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-6">
        <Button
          variant={tier.highlight ? "default" : "outline"}
          className={`w-full ${
            tier.highlight
              ? "bg-teal-500 text-white hover:bg-teal-400"
              : "border-white/15 bg-transparent text-slate-200 hover:bg-white/5"
          }`}
          data-testid={`pricing-cta-${tier.name.toLowerCase()}`}
          asChild
        >
          <Link href="/assessment">{tier.cta}</Link>
        </Button>
      </div>
    </div>
  );
}

export default function Pricing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <BrandHeader />

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Built for travellers and firms.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-400 sm:text-base">
            Choose the audience to preview pricing. Each tier is designed around
            real product capability — rules engine, document intelligence,
            copilot actions, and firm-grade workflows.
          </p>
        </div>

        <Tabs defaultValue="travellers" className="mt-10">
          <TabsList className="mx-auto grid w-full max-w-md grid-cols-2 rounded-full bg-slate-900/80 p-1 ring-1 ring-white/10">
            <TabsTrigger
              value="travellers"
              className="rounded-full data-[state=active]:bg-teal-500/15 data-[state=active]:text-teal-300 data-[state=active]:ring-1 data-[state=active]:ring-teal-400/40"
              data-testid="pricing-tab-travellers"
            >
              <Plane className="mr-2 h-4 w-4" />
              Individual Travellers
            </TabsTrigger>
            <TabsTrigger
              value="firms"
              className="rounded-full data-[state=active]:bg-teal-500/15 data-[state=active]:text-teal-300 data-[state=active]:ring-1 data-[state=active]:ring-teal-400/40"
              data-testid="pricing-tab-firms"
            >
              <Building2 className="mr-2 h-4 w-4" />
              Professionals & Firms
            </TabsTrigger>
          </TabsList>

          <TabsContent value="travellers" className="mt-10">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {travellerTiers.map((tier) => (
                <TierCard key={tier.name} tier={tier} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="firms" className="mt-10">
            {firmTiers.length === 0 ? (
              <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-slate-900/60 p-10 text-center">
                <h3 className="text-lg font-semibold text-white">
                  Professionals & Firms pricing — coming soon
                </h3>
                <p className="mt-3 text-sm text-slate-400">
                  We're finalising firm-grade tier pricing. In the meantime, get
                  in touch and we'll walk you through what's included.
                </p>
                <Button
                  asChild
                  className="mt-6 bg-teal-500 text-white hover:bg-teal-400"
                >
                  <Link href="/assessment">
                    Start an assessment
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {firmTiers.map((tier) => (
                  <TierCard key={tier.name} tier={tier} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <p className="mt-12 text-center text-xs text-slate-500">
          Prices in ZAR. All plans include the guided assessment and document
          checklist. Cancel any time.
        </p>
      </main>
    </div>
  );
}
