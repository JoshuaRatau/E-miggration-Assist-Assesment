import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, formatDistanceToNowStrict } from "date-fns";
import type { Lead } from "@workspace/api-client-react";
import { getAdminToken } from "@/lib/adminToken";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { LeadScoreBadge } from "@/components/lead-score-badge";
import { LeadSourceBadge } from "@/components/lead-source-badge";
import { LeadActivityFeed } from "@/components/lead-activity-feed";
import { segmentOfLead } from "@/lib/leadSegment";
import { followUpInfo } from "@/lib/followUp";
import { canAdvanceStatus, statusLabel } from "@/lib/leadStatus";
import { tierBadgeClass, tierLabel } from "@/lib/intendedTier";
import { enquiryCategoryLabel } from "@/lib/typeOfEnquiry";
import { deriveLeadScore } from "@/lib/leadScore";
import { useAssignableUsers } from "@/lib/useAssignableUsers";
import { useToast } from "@/hooks/use-toast";

// Canonical funnel + priority lists, mirrored from the leads table so the
// in-drawer editors offer the same options.  These are deliberately small,
// stable enums; keeping a local copy avoids a cross-import from the page.
const STATUS_VALUES = [
  "new",
  "reviewing",
  "needs_more_information",
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

// Drawer-local SLA decode — delegates to the shared `followUpInfo` helper so a
// lead's follow-up state reads identically across the table pill, drawer, and
// detail page. Adds a preformatted date string for the drawer's layout.
function slaState(lead: Lead): {
  label: string;
  dot: string;
  date: string | null;
  note: string | null;
} {
  const info = followUpInfo(lead);
  return {
    label: info.label,
    dot: info.dot,
    date: info.dueAt ? format(info.dueAt, "MMM d, yyyy") : null,
    note: info.note,
  };
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
 * A tabbed intelligence view of the selected lead built from existing lead
 * data only:
 *  - Summary  — quick actions, inline status/priority editors, an elevated
 *    follow-up context block, and the read-only lead/contact/segment/score/
 *    source/organisation sections.
 *  - Activity — the per-lead activity feed rendered inline (reuses the shared
 *    `/admin/leads/:id/timeline` feed; no new backend call).
 *  - Notes    — editable internal notes persisted through the page's existing
 *    PATCH handler (which already accepts `adminNotes`).
 *
 * Quick actions (contact, convert / open case, send update, archive / restore,
 * delete) delegate back to the page's existing handlers. Close behaviour
 * (icon / Escape / backdrop) is provided by the Radix Sheet primitive.
 */
export function LeadDrawer({
  lead,
  onClose,
  archivedView = false,
  onPatch,
  onContact,
  onConvert,
  onSendUpdate,
  onArchive,
  onDelete,
}: {
  lead: Lead | null;
  onClose: () => void;
  archivedView?: boolean;
  onPatch?: (
    id: string,
    patch: { status?: string; priority?: string; notes?: string | null },
  ) => void | Promise<Lead | null>;
  onContact?: (lead: Lead) => void;
  onConvert?: (lead: Lead) => void;
  onSendUpdate?: (lead: Lead) => void;
  onArchive?: (lead: Lead, archive: boolean) => void;
  onDelete?: (lead: Lead) => void;
}) {
  const { toast } = useToast();
  const { labelFor } = useAssignableUsers();
  const open = lead !== null;
  const segment = lead ? segmentOfLead(lead) : null;
  const name =
    lead?.fullName ??
    lead?.organizationName ??
    lead?.representativeName ??
    lead?.email ??
    lead?.referenceNumber ??
    "Lead";

  // The slim list serializer (GET /api/leads → AdminLeadListItem) intentionally
  // omits `adminNotes`, so the prop `lead` never carries the operator notes.
  // Fetch the full lead from the admin-gated by-id endpoint to read + edit the
  // real notes. Shares the React Query cache key with the lead-detail page so
  // edits stay consistent across both surfaces.
  const qc = useQueryClient();
  const { data: fullLead } = useQuery<Lead, Error>({
    queryKey: ["admin", "lead", lead?.id],
    enabled: !!lead?.id && open,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const res = await fetch(
        `${(import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "")}/api/leads/by-id/${lead!.id}`,
        { credentials: "include", headers: { "x-admin-token": token } },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return (await res.json()) as Lead;
    },
  });

  // Editable notes — local draft seeded from the full lead. Re-seeds on lead
  // id change and whenever the fetched notes value changes (initial load and
  // after a save-driven refetch), keeping the dirty check correct.
  const [notesDraft, setNotesDraft] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => {
    setNotesDraft(fullLead?.adminNotes ?? "");
  }, [lead?.id, fullLead?.adminNotes]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const notesDirty = (fullLead?.adminNotes ?? "") !== notesDraft;

  const saveNotes = async () => {
    if (!lead || !onPatch || !notesDirty) return;
    const nextNotes = notesDraft.trim() === "" ? null : notesDraft;
    setSavingNotes(true);
    try {
      const result = await Promise.resolve(
        onPatch(lead.id, { notes: nextNotes }),
      );
      // patchLead resolves to the updated lead on success, null on failure
      // (it raises its own destructive toast on failure). Only confirm on a
      // truthy result so we never double-report a failure.
      if (result) {
        // Sync the full-lead cache so the dirty check clears immediately and
        // the saved value survives a drawer reopen (the slim list omits it).
        // Write the authoritative PATCH response unconditionally (merged over
        // any existing entry) so it is correct even when the by-id fetch has
        // not resolved yet — falling back to the sent value if the response
        // somehow lacks notes.
        qc.setQueryData<Lead>(["admin", "lead", lead.id], (old) => ({
          ...old,
          ...result,
          adminNotes: result.adminNotes ?? nextNotes,
        }));
        toast({ title: "Notes saved" });
      }
    } finally {
      setSavingNotes(false);
    }
  };

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
          <Tabs
            defaultValue="summary"
            className="flex min-h-0 flex-1 flex-col"
            data-testid="drawer-tabs"
          >
            <TabsList className="mx-5 mt-4 grid w-auto grid-cols-3">
              <TabsTrigger value="summary" data-testid="drawer-tab-summary">
                Summary
              </TabsTrigger>
              <TabsTrigger value="activity" data-testid="drawer-tab-activity">
                Activity
              </TabsTrigger>
              <TabsTrigger value="notes" data-testid="drawer-tab-notes">
                Notes
              </TabsTrigger>
            </TabsList>

            {/* Summary */}
            <TabsContent
              value="summary"
              className="mt-0 flex-1 space-y-5 overflow-y-auto p-5"
            >
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

              {/* Follow-up context — elevated so the next action + its SLA are
                  the first thing the operator reads. */}
              <section
                className="space-y-2 rounded-lg border bg-muted/30 p-3"
                data-testid="drawer-section-followup"
              >
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Follow-up context
                </h3>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                  <Field label="Status">
                    {sla && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${sla.dot}`} />
                        {sla.label}
                        {sla.date && (
                          <span className="text-muted-foreground">
                            · {sla.date}
                          </span>
                        )}
                      </span>
                    )}
                  </Field>
                  <Field label="Next step">{safe(lead.nextStep)}</Field>
                  <Field label="Last contacted">
                    {lead.lastContactedAt
                      ? format(
                          new Date(lead.lastContactedAt),
                          "MMM d, yyyy HH:mm",
                        )
                      : safe(null)}
                  </Field>
                  <Field label="Owner">
                    {lead.assignedTo ? labelFor(lead.assignedTo) : "Unassigned"}
                  </Field>
                  {sla?.note && <Field label="Note">{sla.note}</Field>}
                  {/* Phase 14C — compact activation-email indicator, styled
                      to match existing status pills. Shown only once the
                      portal activation email has been sent. */}
                  {lead.activationEmailSentAt && (
                    <Field label="Activation email">
                      <span
                        className="inline-flex items-center gap-1.5"
                        data-testid="drawer-activation-email-sent"
                      >
                        <span className="inline-flex items-center rounded bg-emerald-600 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Sent
                        </span>
                        <span className="text-muted-foreground">
                          {format(
                            new Date(lead.activationEmailSentAt),
                            "MMM d, yyyy HH:mm",
                          )}
                        </span>
                      </span>
                    </Field>
                  )}
                </dl>
              </section>

              {/* Lead summary */}
              <Section title="Lead summary" testId="drawer-section-summary">
                <Field label="Status">{statusLabel(lead.leadStatus)}</Field>
                <Field label="Priority">
                  <span className="capitalize">{lead.leadPriority ?? "—"}</span>
                </Field>
                <Field label="Owner">
                  {lead.assignedTo ? labelFor(lead.assignedTo) : "Unassigned"}
                </Field>
                <Field label="Next step">{safe(lead.nextStep)}</Field>
              </Section>

              {/* Contact details */}
              <Section title="Contact details" testId="drawer-section-contact">
                <Field label="Email">{safe(lead.email)}</Field>
                <Field label="WhatsApp">
                  {hasWhatsapp
                    ? typeof lead.whatsapp === "string" &&
                      lead.whatsapp.length > 0
                      ? lead.whatsapp
                      : "On file"
                    : safe(null)}
                </Field>
                <Field label="Preferred">
                  {safe(lead.preferredContactMethod)}
                </Field>
              </Section>

              {/* Segment & scenario */}
              <Section
                title="Segment & scenario"
                testId="drawer-section-segment"
              >
                <Field label="Segment">
                  {segment ? (SEGMENT_LABEL[segment] ?? segment) : "—"}
                </Field>
                <Field label="Scenario">{enquiryCategoryLabel(lead)}</Field>
                <Field label="Situation">
                  {safe(lead.immigrationSituation)}
                </Field>
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

              {/* Source / origin */}
              <Section title="Source & origin" testId="drawer-section-source">
                <Field label="Source">
                  <LeadSourceBadge
                    source={lead.source}
                    campaign={lead.sourceCampaign}
                  />
                </Field>
                <Field label="Residence">
                  {safe(lead.countryOfResidence)}
                </Field>
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
                  <Field label="Rep email">
                    {safe(lead.representativeEmail)}
                  </Field>
                  <Field label="Rep phone">
                    {safe(lead.representativePhone)}
                  </Field>
                  <Field label="Firm size">{safe(lead.firmSize)}</Field>
                  <Field label="Service focus">{safe(lead.serviceFocus)}</Field>
                  <Field label="Website">{safe(lead.website)}</Field>
                </Section>
              )}
            </TabsContent>

            {/* Activity */}
            <TabsContent
              value="activity"
              className="mt-0 flex-1 overflow-y-auto p-5"
            >
              <div className="space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent activity
                </h3>
                <LeadActivityFeed leadId={lead.id} />
              </div>
            </TabsContent>

            {/* Notes */}
            <TabsContent
              value="notes"
              className="mt-0 flex-1 overflow-y-auto p-5"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Internal notes
                  </h3>
                  {notesDirty && (
                    <span
                      className="text-[11px] text-amber-600"
                      data-testid="drawer-notes-dirty"
                    >
                      Unsaved changes
                    </span>
                  )}
                </div>
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Add internal notes about this lead. Only the team can see these."
                  className="min-h-[12rem] resize-y text-sm"
                  data-testid="drawer-notes-textarea"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!notesDirty || savingNotes}
                    onClick={() => setNotesDraft(fullLead?.adminNotes ?? "")}
                    data-testid="drawer-notes-reset"
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    disabled={!notesDirty || savingNotes}
                    onClick={() => void saveNotes()}
                    data-testid="drawer-notes-save"
                  >
                    {savingNotes ? "Saving…" : "Save notes"}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
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
