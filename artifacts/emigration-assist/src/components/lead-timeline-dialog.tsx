import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LeadActivityFeed } from "@/components/lead-activity-feed";

// Phase 3 — read-only activity timeline dialog (table-row trigger).
//
// The render/fetch now lives in the shared `LeadActivityFeed` so the
// same feed backs both this dialog and the in-drawer Activity tab. The
// feed fetches lazily on mount; gating it behind `open` keeps the old
// behaviour where thousands of admin rows don't each fire a request.

interface LeadTimelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  referenceNumber?: string | null;
}

export function LeadTimelineDialog({
  open,
  onOpenChange,
  leadId,
  referenceNumber,
}: LeadTimelineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-lead-timeline">
        <DialogHeader>
          <DialogTitle>Activity timeline</DialogTitle>
          <DialogDescription>
            {referenceNumber
              ? `All recorded activity for ${referenceNumber}, newest first.`
              : "All recorded activity for this lead, newest first."}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <LeadActivityFeed
            leadId={leadId}
            className="max-h-[60vh] overflow-y-auto pr-1"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
