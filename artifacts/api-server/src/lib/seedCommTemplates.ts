/**
 * Phase 6D-1 — Default template library.
 *
 * 20 professionally-written email templates (4 per category × 5 categories)
 * that are seeded into `comm_templates` on first server boot — see
 * `templateBootstrap.ts`. The bootstrap is idempotent on `name`: any
 * template whose name already exists in the table is left untouched, so
 * operators are never overwritten if they edit a seeded template.
 *
 * Bodies are HTML — table-based layout with inline styles so they
 * render cleanly in Gmail, Outlook desktop, Apple Mail, and on mobile
 * without an external CSS sheet (email clients strip <style> blocks
 * inconsistently). Once PR 6D-2 ships the rich editor, operators can
 * load any of these and visually edit further.
 *
 * Merge tokens supported (from `lib/campaignRender.ts`):
 *   {{first_name}}        → first word of fullName, "there" when blank
 *   {{full_name}}         → fullName verbatim, "there" when blank
 *   {{reference}}         → EMA-XXXX reference (always present)
 *   {{organization_name}} → B2B org name, "your team" when blank
 */

export type SeedCategory =
  | "promotional"
  | "system_update"
  | "new_feature"
  | "educational"
  | "customer_experience";

export interface SeedTemplate {
  name: string;
  category: SeedCategory;
  channel: "email";
  subject: string;
  body: string;
}

// Brand palette — sourced from migrations.co.za to keep email chrome
// visually native to the product surface customers already know:
//   Petrol teal gradient (hero band)        #0e6470 → #1a8c9c
//   Mint accent / primary CTA               #2dd4a7  (dark text inside)
//   Dark navy surround / footer parity      #0a1929
//   Slate body text                         #1f2937
//   Muted border / hairline                 #e5e7eb
//
// Shared HTML wrapper. Every seeded template uses this so the library
// reads as one cohesive brand voice. 600px container, table-based
// layout for Outlook compatibility, all styles inline (Gmail / Yahoo
// strip <style> blocks unpredictably).
const wrap = (inner: string): string => `<div style="background:#0a1929;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;max-width:600px;width:100%;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#0e6470 0%,#1a8c9c 100%);padding:28px 40px;">
      <div style="font-weight:700;font-size:18px;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;">E-Migration Assist</div>
      <div style="font-size:12px;color:#a7e8de;letter-spacing:0.02em;margin-top:4px;">Your trusted immigration platform</div>
    </td></tr>
    <tr><td style="padding:36px 40px 32px 40px;color:#1f2937;font-size:15px;line-height:1.65;">
${inner}
    </td></tr>
    <tr><td style="padding:20px 40px 28px 40px;color:#6b7280;font-size:12px;line-height:1.55;border-top:1px solid #e5e7eb;background:#fafbfc;">
      <div style="margin-bottom:6px;color:#0e6470;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;font-size:11px;">E-Migration Assist · South Africa</div>
      You are receiving this email because you registered with E-Migration Assist (reference <strong style="color:#1f2937;">{{reference}}</strong>). If you'd prefer not to receive these updates, you can unsubscribe below.
    </td></tr>
  </table>
</div>`;

// Mint pill CTA mirrors the "Start as a Traveller" button on the
// product homepage — vibrant accent on dark text for high contrast.
const cta = (label: string, href = "#"): string =>
  `<p style="margin:28px 0 8px 0;"><a href="${href}" style="background:#2dd4a7;color:#0a1929;text-decoration:none;font-weight:600;padding:13px 26px;border-radius:999px;display:inline-block;font-size:14px;">${label} ›</a></p>`;

// Inline notice band. Defaults to brand teal; pass overrides for
// warning (amber) / success (mint) / alert (rose) variants.
const banner = (text: string, bg = "#e0f2f1", colour = "#0e6470"): string =>
  `<div style="background:${bg};color:${colour};padding:14px 18px;border-radius:10px;font-weight:600;font-size:13px;letter-spacing:0.01em;margin:0 0 24px 0;border-left:3px solid ${colour};">${text}</div>`;

// ---------------------------------------------------------------------
// Promotional (4)
// ---------------------------------------------------------------------

const PROMOTIONAL: SeedTemplate[] = [
  {
    name: "Promotional — Subscription discount campaign",
    category: "promotional",
    channel: "email",
    subject: "An exclusive 25% off your first year of E-Migration Assist",
    body: wrap(`${banner("Limited-time offer · ends in 14 days", "#fef3c7", "#92400e")}
<p>Hi {{first_name}},</p>
<p>To celebrate the next chapter of E-Migration Assist, we're offering you <strong>25% off your first year</strong> on any plan — including our Plus and Pro tiers.</p>
<p>Whether you're managing a single relocation or coordinating a portfolio of immigration cases, this is the most cost-effective moment to upgrade.</p>
${cta("Claim your 25% discount")}
<p style="color:#6b7280;font-size:13px;margin-top:24px;">Reference: <strong>{{reference}}</strong>. Offer applies to new annual subscriptions only.</p>`),
  },
  {
    name: "Promotional — Pilot programme invitation",
    category: "promotional",
    channel: "email",
    subject: "Invitation: join the E-Migration Assist 2026 pilot programme",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>We're hand-selecting a small group of immigration professionals and emigrating families to join our 2026 pilot programme — and {{organization_name}} is on the shortlist.</p>
<p>Pilot members receive:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">Dedicated onboarding with our specialist team</li>
  <li style="margin-bottom:6px;">Priority access to new features before public release</li>
  <li style="margin-bottom:6px;">Lifetime founding-member pricing</li>
  <li>Direct line to our product roadmap</li>
</ul>
${cta("Reserve your pilot seat")}
<p>Spaces close on Friday. We'd love to have you with us.</p>`),
  },
  {
    name: "Promotional — Limited-time onboarding special",
    category: "promotional",
    channel: "email",
    subject: "{{first_name}}, your fast-track onboarding is open until Sunday",
    body: wrap(`${banner("Fast-track onboarding · this week only", "#ecfdf5", "#047857")}
<p>Hi {{first_name}},</p>
<p>For this week only, we're waiving our standard onboarding fee and pairing every new subscriber with a senior immigration specialist for a complimentary 60-minute strategy call.</p>
<p>This is the easiest way to get from initial assessment (reference {{reference}}) to a fully structured immigration roadmap — without the usual lead time.</p>
${cta("Activate fast-track onboarding")}
<p style="color:#6b7280;font-size:13px;">Offer expires Sunday at midnight SAST.</p>`),
  },
  {
    name: "Promotional — Annual package upgrade incentive",
    category: "promotional",
    channel: "email",
    subject: "Save R3,600 when you switch to annual billing",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>You've been with us for a few months now — thank you for that. We thought you should know that switching to annual billing on your current plan saves you the equivalent of <strong>three months free</strong>.</p>
<p>That's R3,600 back in your pocket if you're on Pro, and it locks in your current rate for the next 12 months even if pricing changes.</p>
${cta("Switch to annual and save")}
<p>Questions? Just reply to this email — we read every response.</p>`),
  },
];

// ---------------------------------------------------------------------
// System Update (4)
// ---------------------------------------------------------------------

const SYSTEM_UPDATE: SeedTemplate[] = [
  {
    name: "System Update — Scheduled maintenance notice",
    category: "system_update",
    channel: "email",
    subject: "Scheduled maintenance · Sunday 02:00–04:00 SAST",
    body: wrap(`${banner("Scheduled maintenance · Sunday 02:00–04:00 SAST", "#eff6ff", "#1d4ed8")}
<p>Hi {{first_name}},</p>
<p>We'll be performing scheduled platform maintenance this Sunday between <strong>02:00 and 04:00 SAST</strong>. During this window, the dashboard, document upload, and case-management tools may be briefly unavailable.</p>
<p>What you should know:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">Your data is fully preserved — no action is required.</li>
  <li style="margin-bottom:6px;">In-flight uploads should be completed beforehand.</li>
  <li>Email and WhatsApp notifications resume immediately after.</li>
</ul>
<p>Thank you for your patience as we keep E-Migration Assist running at its best.</p>`),
  },
  {
    name: "System Update — Temporary service interruption",
    category: "system_update",
    channel: "email",
    subject: "Service update · we're investigating an issue affecting some accounts",
    body: wrap(`${banner("Status: investigating", "#fef2f2", "#b91c1c")}
<p>Hi {{first_name}},</p>
<p>We're aware that a small number of users (potentially including you) are experiencing slower-than-normal load times this morning. Our engineering team is investigating actively.</p>
<p>What we know so far:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">No data has been lost or compromised.</li>
  <li style="margin-bottom:6px;">Existing case records remain accessible.</li>
  <li>Document uploads may need to be retried.</li>
</ul>
<p>We'll send you a follow-up the moment service is fully restored. We're sorry for the disruption.</p>`),
  },
  {
    name: "System Update — Platform performance improvements",
    category: "system_update",
    channel: "email",
    subject: "We've made E-Migration Assist 3× faster",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>Over the past two weeks, our team rolled out a series of infrastructure upgrades that meaningfully change how the platform feels day-to-day:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;"><strong>3× faster</strong> dashboard load times</li>
  <li style="margin-bottom:6px;">Sub-second case search across the full archive</li>
  <li style="margin-bottom:6px;">Bulk uploads now complete in roughly a third of the previous time</li>
  <li>Mobile experience completely overhauled</li>
</ul>
<p>You don't need to do anything — these improvements are already live for your account ({{reference}}).</p>
${cta("Open the dashboard")}`),
  },
  {
    name: "System Update — Security update notification",
    category: "system_update",
    channel: "email",
    subject: "An important security update for your E-Migration Assist account",
    body: wrap(`${banner("Action recommended within 7 days", "#fef3c7", "#92400e")}
<p>Hi {{first_name}},</p>
<p>As part of our continuous commitment to protecting your data, we've rolled out a platform-wide security update. Most of it requires no action from you — but we strongly recommend two quick steps:</p>
<ol style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:8px;"><strong>Enable two-factor authentication</strong> on your account if you haven't already.</li>
  <li><strong>Review your active sessions</strong> and sign out any device you don't recognise.</li>
</ol>
${cta("Review my security settings")}
<p style="color:#6b7280;font-size:13px;">If anything looks unusual, contact us immediately. Your account reference is {{reference}}.</p>`),
  },
];

// ---------------------------------------------------------------------
// New Feature (4)
// ---------------------------------------------------------------------

const NEW_FEATURE: SeedTemplate[] = [
  {
    name: "New Feature — Dashboard enhancements",
    category: "new_feature",
    channel: "email",
    subject: "New: a smarter dashboard, designed around your workflow",
    body: wrap(`${banner("Now live · zero setup required", "#ecfdf5", "#047857")}
<p>Hi {{first_name}},</p>
<p>We've completely redesigned the E-Migration Assist dashboard around the patterns we've watched our most successful users follow. The result is a workspace that surfaces what matters most — at the moment it matters.</p>
<p>What's new:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">Real-time case-status summaries at a glance</li>
  <li style="margin-bottom:6px;">Personalised follow-up suggestions based on lead activity</li>
  <li style="margin-bottom:6px;">A unified search bar that spans every record you have access to</li>
  <li>Drag-and-drop pipeline reordering</li>
</ul>
${cta("See the new dashboard")}`),
  },
  {
    name: "New Feature — WhatsApp integration launch",
    category: "new_feature",
    channel: "email",
    subject: "WhatsApp is now built into your E-Migration Assist workflow",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>You can now send and receive WhatsApp messages directly inside the case timeline — no more switching between apps, no more lost context.</p>
<p>What you get out of the box:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">Two-way WhatsApp messaging tied to each lead and case</li>
  <li style="margin-bottom:6px;">Automatic delivery receipts</li>
  <li style="margin-bottom:6px;">Templated quick-replies for common scenarios</li>
  <li>Full conversation history searchable from the case view</li>
</ul>
${cta("Connect my WhatsApp")}
<p style="color:#6b7280;font-size:13px;">Reference: {{reference}}. Available on Plus, Pro, and Premium plans.</p>`),
  },
  {
    name: "New Feature — Subscription analytics rollout",
    category: "new_feature",
    channel: "email",
    subject: "Now you can see your revenue, churn, and tier mix in one place",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>For our B2B subscribers, we've just rolled out a comprehensive subscription analytics suite — letting you see exactly how your immigration practice is performing month over month.</p>
<p>Inside, you'll find:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">Monthly recurring revenue with trend lines</li>
  <li style="margin-bottom:6px;">Churn signals and lead-score deterioration alerts</li>
  <li style="margin-bottom:6px;">Tier mix across your client portfolio</li>
  <li>Exportable CSV reports for your finance team</li>
</ul>
${cta("Open subscription analytics")}`),
  },
  {
    name: "New Feature — Self-assessment improvements",
    category: "new_feature",
    channel: "email",
    subject: "We've reimagined the self-assessment experience",
    body: wrap(`${banner("Updated · 40% faster to complete", "#eff6ff", "#1d4ed8")}
<p>Hi {{first_name}},</p>
<p>The self-assessment that you (and your future clients) use is now noticeably better. We rebuilt it from the ground up based on feedback from over 2,000 completions.</p>
<p>Highlights:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">40% fewer fields, smarter conditional logic</li>
  <li style="margin-bottom:6px;">Inline guidance on every step</li>
  <li style="margin-bottom:6px;">Optional supporting-document upload now feels effortless</li>
  <li>WhatsApp confirmation built in</li>
</ul>
${cta("Try the new assessment")}`),
  },
];

// ---------------------------------------------------------------------
// Educational (4)
// ---------------------------------------------------------------------

const EDUCATIONAL: SeedTemplate[] = [
  {
    name: "Educational — Immigration compliance insights",
    category: "educational",
    channel: "email",
    subject: "Three compliance pitfalls that quietly delay 60% of cases",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>Across the thousands of immigration journeys we've supported, the same three preventable issues account for the majority of unnecessary delays:</p>
<ol style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:10px;"><strong>Inconsistent name spellings</strong> across passports, qualifications, and supporting affidavits.</li>
  <li style="margin-bottom:10px;"><strong>Out-of-date police clearances.</strong> Most jurisdictions require certificates issued within the last 6 months.</li>
  <li><strong>Translation gaps.</strong> Apostille and certified translations are non-negotiable for many destination countries.</li>
</ol>
<p>Our compliance toolkit walks you through each of these in detail and flags issues automatically when documents are uploaded.</p>
${cta("Open the compliance toolkit")}`),
  },
  {
    name: "Educational — Workflow efficiency best practices",
    category: "educational",
    channel: "email",
    subject: "How top-performing immigration practices manage 3× more cases",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>We studied how our most productive subscribers — practices managing 50+ active cases — actually work day to day. Three patterns stood out:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:8px;"><strong>Templated outreach for every funnel stage.</strong> They never write the same email twice.</li>
  <li style="margin-bottom:8px;"><strong>Daily 15-minute pipeline reviews.</strong> Status changes are made live, not in a weekly catch-up.</li>
  <li><strong>Document checklists per visa class.</strong> Reusable, version-controlled, attached to every new case.</li>
</ul>
<p>Each of these is supported natively in your E-Migration Assist workspace.</p>
${cta("See the workflow playbook")}`),
  },
  {
    name: "Educational — Document management guidance",
    category: "educational",
    channel: "email",
    subject: "A 5-minute guide to bulletproof document management",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>Documents are the spine of any immigration case — and the single biggest source of avoidable rework. Here's how to keep yours organised, secure, and audit-ready:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:8px;"><strong>Use one canonical filename pattern.</strong> e.g. <em>SURNAME_DocType_YYYYMMDD.pdf</em></li>
  <li style="margin-bottom:8px;"><strong>Upload originals immediately.</strong> Don't wait until the end of a milestone to batch-upload.</li>
  <li style="margin-bottom:8px;"><strong>Annotate as you go.</strong> Future-you will thank present-you.</li>
  <li><strong>Set expiry reminders</strong> on time-sensitive documents (clearances, medicals).</li>
</ul>
${cta("Open my document vault")}`),
  },
  {
    name: "Educational — Operational immigration trends",
    category: "educational",
    channel: "email",
    subject: "What changed in immigration this quarter — and what it means for you",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>Each quarter our analysts compile the policy shifts, embassy backlogs, and processing-time changes that materially affect outbound migration from South Africa. Highlights from this quarter:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:8px;"><strong>Skills-shortage list updates</strong> in three priority destinations.</li>
  <li style="margin-bottom:8px;"><strong>Visa fee adjustments</strong> across the EU schemes — material for budgeting.</li>
  <li style="margin-bottom:8px;"><strong>Average processing-time shifts</strong> based on our case data.</li>
  <li><strong>One emerging destination</strong> we believe is undervalued.</li>
</ul>
${cta("Read the quarterly briefing")}
<p style="color:#6b7280;font-size:13px;">Reference: {{reference}}.</p>`),
  },
];
// ---------------------------------------------------------------------
// Customer Experience (4)
// ---------------------------------------------------------------------

const CUSTOMER_EXPERIENCE: SeedTemplate[] = [
  {
    name: "Customer Experience — Welcome / onboarding",
    category: "customer_experience",
    channel: "email",
    subject: "Welcome to E-Migration Assist, {{first_name}}",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>Welcome aboard. We're genuinely glad you've chosen E-Migration Assist to support your immigration journey — and we don't take that lightly.</p>
<p>Here's what to expect over the next few days:</p>
<ul style="padding-left:20px;color:#1f2937;">
  <li style="margin-bottom:6px;">A short personalised welcome call from your dedicated specialist</li>
  <li style="margin-bottom:6px;">Your case workspace, tailored to your destination</li>
  <li style="margin-bottom:6px;">A document checklist you can start working through today</li>
  <li>Direct WhatsApp access to our support team</li>
</ul>
${cta("Open my workspace")}
<p style="color:#6b7280;font-size:13px;">Your reference is <strong>{{reference}}</strong> — keep it handy.</p>`),
  },
  {
    name: "Customer Experience — Thank-you message",
    category: "customer_experience",
    channel: "email",
    subject: "Thank you, {{first_name}} — a quick note from our team",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>We just wanted to take a moment to say thank you. Trusting a partner with something as significant as your immigration journey — or your clients' — is a real decision, and we're grateful you've made it with us.</p>
<p>If anything ever feels less than excellent, please reply directly to this email. It comes straight to a real person on our team, not a queue.</p>
<p>Warmly,<br/>The E-Migration Assist team</p>`),
  },
  {
    name: "Customer Experience — Subscription anniversary",
    category: "customer_experience",
    channel: "email",
    subject: "Happy anniversary — a year with E-Migration Assist",
    body: wrap(`${banner("🎉 1 year with us", "#fef3c7", "#92400e")}
<p>Hi {{first_name}},</p>
<p>It's been a full year since you joined E-Migration Assist — and what a year it has been. To mark the occasion, we wanted to share a small snapshot of what we've built together.</p>
<p style="color:#6b7280;font-size:13px;font-style:italic;">[Personalised stats — case count, documents processed, milestones reached — will appear here once you connect to the analytics module.]</p>
<p>As a thank-you, we've added a complimentary month to your next renewal. No action needed — it's already on your account.</p>
${cta("View my account")}`),
  },
  {
    name: "Customer Experience — Feedback / satisfaction request",
    category: "customer_experience",
    channel: "email",
    subject: "{{first_name}}, would you share two minutes of your time?",
    body: wrap(`<p>Hi {{first_name}},</p>
<p>We're constantly working to make E-Migration Assist better — and the most valuable input we get is from people like you, actively using the platform.</p>
<p>Would you be open to sharing your honest feedback? Two minutes, six questions, no marketing follow-up.</p>
${cta("Share my feedback")}
<p>Every response is read by our product lead personally. If you'd prefer a quick call instead, just reply to this email and we'll find a time.</p>
<p>Thank you for being part of this with us.</p>`),
  },
];

export const SEED_COMM_TEMPLATES: ReadonlyArray<SeedTemplate> = [
  ...PROMOTIONAL,
  ...SYSTEM_UPDATE,
  ...NEW_FEATURE,
  ...EDUCATIONAL,
  ...CUSTOMER_EXPERIENCE,
];
