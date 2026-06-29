import type { ReactNode } from "react";
import { Link } from "wouter";
import { format, formatDistanceToNowStrict } from "date-fns";
import type { Lead } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { LeadSourceBadge } from "@/components/lead-source-badge";
import { segmentOfLead, isOverdueSla } from "@/lib/leadSegment";
import { canAdvanceStatus, statusLabel } from "@/lib/leadStatus";
import { tierBadgeClass, tierLabel } from "@/lib/intendedTier";
import { enquiryCategoryLabel } from "@/lib/typeOfEnquiry";
import { deriveLeadScore } from "@/lib/leadScore";

// Canonical funnel + priority lists, mirrored from the leads table so the
// in-drawer editors offer the same options.  These are deliberately small,
// stable enums; keeping a local copy avoids a cross-import from the page.
const STATUS_VALUES = [
  "new",
  "reviewing",
  "contacted",
  "engaged",
  "qualified",
  "proposal_sent",
  "ready_for_case",
  "converted",
  "closed",
] as const;
const PRIORITY_VALUES = ["critical", "high", "medium", "low"] as const;

const SEGMENT_LABEL: Record<string, string> = {
  individual: "Individual",
  overstay: "Overstay",
  business: "Business",
};

function segmentPillClass(segment: string): string {
  if (segment === "overstay") return "bg-amber-100 text-amber-800";
  if (segment === "business") return "bg-indigo-100 text-indigo-800";
  return "bg-blue-100 text-blue-800";
}

// Drawer-local SLA decode — kept consistent with the leads-table SlaPill so a
// lead's follow-up state reads identically in both surfaces.
function slaState(lead: Lead): {
  label: string;
  dot: string;
  date: string | null;
} {
  const raw = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  if (!raw || Number.isNaN(raw.getTime())) {
    return { label: "Not set", dot: "bg-muted-foreground/40", date: null };
  }
  const now = new Date();
  const overdue = isOverdueSla(lead, now);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const dateStr = format(raw, "MMM d, yyyy");
  if (overdue) return { label: "Overdue", dot: "bg-amber-500", date: dateStr };
  if (raw.getTime() <= endOfToday.getTime())
    return { label: "Due today", dot: "bg-blue-500", date: dateStr };
  if (raw.getTime() < now.getTime())
    return { label: "Closed", dot: "bg-muted-foreground/40", date: dateStr };
  return { label: "On track", dot: "bg-emerald-500", date: dateStr };
}

function safe(value: string | null | undefined): ReactNode {
  if (value === null || value === undefined || value.trim() === "") {
    return <span className="text-muted-foreground">Not provided</span>;
  }
  return value;
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="col-span-1 text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words font-medium">{children}</dd>
    </>
  );
}

/**
 * Right-side lead drawer.
 *
 * Renders a read-only intelligence view of the selected lead using existing
 * lead data only, plus inline status/priority editors and the full set of
 * lead quick actions delegated back to the page (contact, convert / open
 * case, send update, timeline, archive / restore, delete).  No new backend
 * calls are introduced — everything reuses the page's existing handlers.
 *
 * Close behaviour (icon / Escape / backdrop) is provided by the Radix Sheet
 * primitive.
 */
export function LeadDrawer({
  lead,
  onClose,
  archivedView = false,
  onPatch,
  onContact,
  onConvert,
  onSendUpdate,
  onTimeline,
  onArchive,
  onDelete,
}: {
  lead: Lead | null;
  onClose: () => void;
  archivedView?: boolean;
  onPatch?: (
    id: string,
    patch: { status?: string; priority?: string },
  ) => void | Promise<unknown>;
  onContact?: (lead: Lead) => void;
  onConvert?: (lead: Lead) => void;
  onSendUpdate?: (lead: Lead) => void;
  onTimeline?: (lead: Lead) => void;
  onArchive?: (lead: Lead, archive: boolean) => void;
  onDelete?: (lead: Lead) => void;
}) {
  const open = lead !== null;
  const segment = lead ? segmentOfLead(lead) : null;
  const name =
    lead?.fullName ??
    lead?.organizationName ??
    lead?.representativeName ??
    lead?.email ??
    lead?.referenceNumber ??
    "Lead";

  const hasWhatsapp = lead
    ? (lead.hasWhatsapp ??
      (typeof lead.whatsapp === "string" && lead.whatsapp.length > 0))
    : false;
  // Concrete WhatsApp digits — mirrors `contactHref()` enablement on the page
  // so the Contact button is only enabled when a click can actually open a
  // channel (wa.me needs digits; mailto needs an email).
  const whatsappDigits =
    typeof lead?.whatsapp === "string"
      ? lead.whatsapp.replace(/[^0-9]/g, "")
      : "";
  const canContact = !!(lead?.email || whatsappDigits.length > 0);
  // Send-update mirrors the leads-table row's looser enablement (email OR a
  // WhatsApp on file), since that flow targets stored contact channels.
  const canSendUpdate = !!(lead?.email || hasWhatsapp);
  const score = lead ? deriveLeadScore(lead) : null;
  const sla = lead ? slaState(lead) : null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
        data-testid="dashboard-lead-drawer"
      >
        <SheetHeader className="space-y-2 border-b p-5">
          <div className="flex flex-wrap items-center gap-2">
            {segment && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${segmentPillClass(segment)}`}
                data-testid="drawer-segment-pill"
              >
                {SEGMENT_LABEL[segment] ?? segment}
              </span>
            )}
            {lead?.leadType === "professional" && (
              <span className="inline-flex items-center rounded border border-blue-300 bg-blue-50 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-blue-700">
                B2B
              </span>
            )}
          </div>
          <SheetTitle data-testid="drawer-lead-name">{name}</SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {lead?.referenceNumber}
          </SheetDescription>
        </SheetHeader>

        {lead && (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!canContact}
                title={
                  canContact
                    ? "Open WhatsApp or email (pre-filled) and mark contacted"
                    : "No email or WhatsApp on file"
                }
                onClick={() => onContact?.(lead)}
                data-testid="drawer-action-contact"
              >
                Contact
              </Button>
              {lead.leadStatus === "ready_for_case" && (
                <Button
                  size="sm"
                  onClick={() => onConvert?.(lead)}
                  data-testid="drawer-action-convert"
                  title="Convert this lead into a case"
                >
                  Convert to Case
                </Button>
              )}
              {lead.leadStatus === "converted" && lead.caseId && (
                <Link href={`/admin/case/${lead.caseId}`}>
                  <Button
                    size="sm"
                    data-testid="drawer-action-open-case"
                    title="Open the linked case"
                  >
                    Open Case
                  </Button>
                </Link>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!canSendUpdate}
                onClick={() => onSendUpdate?.(lead)}
                data-testid="drawer-action-send-update"
                title={
                  canSendUpdate
                    ? "Send a one-off update to this lead"
                    : "No email or WhatsApp on file"
                }
              >
                Send update
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onTimeline?.(lead)}
                data-testid="drawer-action-timeline"
                title="View full activity timeline"
              >
                Timeline
              </Button>
            </div>

            {/* Inline status / priority editors */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Status
                </span>
                <Select
                  value={lead.leadStatus}
                  onValueChange={(v) => onPatch?.(lead.id, { status: v })}
                >
                  <SelectTrigger
                    className="h-8 w-[11rem] text-xs"
                    data-testid="drawer-select-status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_VALUES.map((s) => {
                      const allowed = canAdvanceStatus(lead.leadStatus, s);
                      return (
                        <SelectItem
                          key={s}
                          value={s}
                          disabled={!allowed}
                          title={
                            allowed
                              ? undefined
                              : "Forward-only funnel — cannot regress"
                          }
                        >
                          {statusLabel(s)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Priority
                </span>
                <Select
                  value={lead.leadPriority ?? "medium"}
                  onValueChange={(v) => onPatch?.(lead.id, { priority: v })}
                >
                  <SelectTrigger
                    className="h-8 w-[8rem] text-xs capitalize"
                    data-testid="drawer-select-priority"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_VALUES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lead summary */}
            <Section title="Lead summary" testId="drawer-section-summary">
              <Field label="Status">{statusLabel(lead.leadStatus)}</Field>
              <Field label="Priority">
                <span className="capitalize">{lead.leadPriority ?? "—"}</span>
              </Field>
              <Field label="Owner">
                {lead.assignedTo ? "Assigned" : "Unassigned"}
              </Field>
              <Field label="Next step">{safe(lead.nextStep)}</Field>
            </Section>

            {/* Contact details */}
            <Section title="Contact details" testId="drawer-section-contact">
              <Field label="Email">{safe(lead.email)}</Field>
              <Field label="WhatsApp">
                {hasWhatsapp
                  ? typeof lead.whatsapp === "string" && lead.whatsapp.length > 0
                    ? lead.whatsapp
                    : "On file"
                  : safe(null)}
              </Field>
              <Field label="Preferred">{safe(lead.preferredContactMethod)}</Field>
            </Section>

            {/* Segment & scenario */}
            <Section title="Segment & scenario" testId="drawer-section-segment">
              <Field label="Segment">
                {segment ? (SEGMENT_LABEL[segment] ?? segment) : "—"}
              </Field>
              <Field label="Scenario">{enquiryCategoryLabel(lead)}</Field>
              <Field label="Situation">{safe(lead.immigrationSituation)}</Field>
              <Field label="Category">{safe(lead.leadCategory)}</Field>
            </Section>

            {/* Score & tier */}
            <Section title="Score & tier" testId="drawer-section-score">
              <Field label="Score">
                <span className="inline-flex items-center gap-2">
                  <LeadScoreBadge
                    lead={lead}
                    testIdSuffix={lead.referenceNumber ?? lead.id}
                  />
                  {score && (
                    <span className="text-muted-foreground">
                      {score.score}/100
                    </span>
                  )}
                </span>
              </Field>
              <Field label="Tier">
                {lead.intendedTier ? (
                  <span
                    className={`inline-flex items-center rounded border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide ${tierBadgeClass(lead.intendedTier)}`}
                  >
                    {tierLabel(lead.intendedTier)}
                  </span>
                ) : (
                  safe(null)
                )}
              </Field>
              <Field label="Rubric">{safe(lead.leadScoreRubric)}</Field>
            </Section>

            {/* SLA / follow-up */}
            <Section title="SLA / follow-up" testId="drawer-section-sla">
              <Field label="Follow-up">
                {sla && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${sla.dot}`} />
                    {sla.label}
                    {sla.date && (
                      <span className="text-muted-foreground">· {sla.date}</span>
                    )}
                  </span>
                )}
              </Field>
              <Field label="Last contacted">
                {lead.lastContactedAt
                  ? format(new Date(lead.lastContactedAt), "MMM d, yyyy HH:mm")
                  : safe(null)}
              </Field>
            </Section>

            {/* Source / origin */}
            <Section title="Source & origin" testId="drawer-section-source">
              <Field label="Source">
                <LeadSourceBadge
                  source={lead.source}
                  campaign={lead.sourceCampaign}
                />
              </Field>
              <Field label="Residence">{safe(lead.countryOfResidence)}</Field>
              <Field label="Nationality">{safe(lead.nationality)}</Field>
              <Field label="In South Africa">
                {lead.currentlyInSouthAfrica === null ||
                lead.currentlyInSouthAfrica === undefined
                  ? safe(null)
                  : lead.currentlyInSouthAfrica
                    ? "Yes"
                    : "No"}
              </Field>
              <Field label="Submitted">
                {formatDistanceToNowStrict(new Date(lead.createdAt), {
                  addSuffix: true,
                })}
                <span className="ml-1 text-muted-foreground">
                  ({format(new Date(lead.createdAt), "MMM d, yyyy")})
                </span>
              </Field>
            </Section>

            {/* B2B details */}
            {lead.leadType === "professional" && (
              <Section title="Organisation" testId="drawer-section-b2b">
                <Field label="Name">{safe(lead.organizationName)}</Field>
                <Field label="Type">{safe(lead.organizationType)}</Field>
                <Field label="Contact">{safe(lead.representativeName)}</Field>
                <Field label="Role">{safe(lead.representativeRole)}</Field>
                <Field label="Rep email">{safe(lead.representativeEmail)}</Field>
                <Field label="Rep phone">{safe(lead.representativePhone)}</Field>
                <Field label="Firm size">{safe(lead.firmSize)}</Field>
                <Field label="Service focus">{safe(lead.serviceFocus)}</Field>
                <Field label="Website">{safe(lead.website)}</Field>
              </Section>
            )}

            {/* Notes */}
            <Section title="Notes" testId="drawer-section-notes">
              <Field label="Admin notes">{safe(lead.adminNotes)}</Field>
            </Section>
          </div>
        )}

        <SheetFooter className="flex-col gap-2 border-t p-5 sm:flex-col">
          {lead && (
            <>
              <div className="flex w-full gap-2">
                {archivedView ? (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => onArchive?.(lead, false)}
                    data-testid="drawer-action-restore"
                    title="Restore this lead to the active funnel"
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => onArchive?.(lead, true)}
                    data-testid="drawer-action-archive"
                    title="Archive this lead — hidden from the funnel but recoverable"
                  >
                    Archive
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={() => onDelete?.(lead)}
                  data-testid="drawer-action-delete"
                  title="Permanently delete this lead"
                >
                  Delete
                </Button>
              </div>
              <Link href={`/admin/lead/${lead.id}`} className="w-full">
                <Button
                  className="w-full"
                  data-testid="dashboard-lead-drawer-open-full"
                >
                  Open full lead
                </Button>
              </Link>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
