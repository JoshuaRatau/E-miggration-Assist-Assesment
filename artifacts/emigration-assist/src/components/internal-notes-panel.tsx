import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminToken, clearAdminToken } from "@/lib/adminToken";

// Phase 11B — internal-only lead notes.
//
// Reuses the existing append-only `lead_audit` history mechanism: each
// note is a `lead_note_added` audit row surfaced via the dedicated
// `GET /api/admin/leads/:id/notes` endpoint (a filtered projection of the
// same audit table that backs the shared activity timeline). Notes are
// admin-only and never rendered on any public / customer-facing screen.
//
// The endpoint is intentionally OUT of the OpenAPI contract (sibling
// resource), so its response type lives alongside its only consumer.

interface LeadNote {
  id: string;
  note: string;
  createdAt: string;
  actorEmail: string | null;
}

interface LeadNotesResponse {
  leadId: string;
  notes: LeadNote[];
}

function apiBase(): string {
  return (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(
    /\/$/,
    "",
  );
}

export function InternalNotesPanel({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const notesKey = ["admin", "lead", leadId, "notes"] as const;

  const { data, isLoading, isError, error } = useQuery<
    LeadNotesResponse,
    Error
  >({
    queryKey: notesKey,
    queryFn: async () => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const res = await fetch(`${apiBase()}/api/admin/leads/${leadId}/notes`, {
        credentials: "include",
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return (await res.json()) as LeadNotesResponse;
    },
  });

  const addNote = useMutation<LeadNote, Error, string>({
    mutationFn: async (note: string) => {
      const token = getAdminToken();
      if (!token) throw new Error("Admin token required");
      const res = await fetch(`${apiBase()}/api/admin/leads/${leadId}/notes`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ note }),
      });
      if (res.status === 401) {
        clearAdminToken();
        throw new Error("Invalid admin token");
      }
      if (!res.ok) {
        const msg = await res
          .json()
          .then((b: { error?: string }) => b.error)
          .catch(() => null);
        throw new Error(msg ?? `Server returned ${res.status}`);
      }
      return (await res.json()) as LeadNote;
    },
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: notesKey });
      // The shared activity timeline (LeadActivityFeed) reads the same
      // `lead_audit` rows, so the note also appears there — but that feed
      // fetches on mount rather than via React Query, so it refreshes the
      // next time it is opened; nothing to invalidate here.
    },
  });

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !addNote.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
        <CardDescription>
          Append-only notes visible only to staff inside the admin panel. They
          are never shown to the lead or exposed publicly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an internal note about this lead…"
            rows={3}
            maxLength={5000}
            data-testid="internal-note-input"
          />
          <div className="flex items-center justify-between gap-3">
            {addNote.isError ? (
              <span
                className="text-xs text-rose-400"
                data-testid="internal-note-error"
              >
                {addNote.error?.message ?? "Failed to add note"}
              </span>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={() => addNote.mutate(trimmed)}
              data-testid="internal-note-submit"
            >
              {addNote.isPending ? "Adding…" : "Add note"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : isError ? (
          <div
            className="text-sm text-rose-400"
            data-testid="internal-notes-error"
          >
            Failed to load notes: {error?.message ?? "unknown error"}
          </div>
        ) : !data || data.notes.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="internal-notes-empty"
          >
            No internal notes yet.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="internal-notes-list">
            {data.notes.map((n) => (
              <li
                key={n.id}
                className="rounded-md border border-border/60 bg-card/40 p-3"
                data-testid="internal-note-row"
              >
                <p className="whitespace-pre-wrap text-sm">{n.note}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{n.actorEmail ?? "Unknown author"}</span>
                  <span>·</span>
                  <time title={format(new Date(n.createdAt), "PPpp")}>
                    {formatDistanceToNow(new Date(n.createdAt), {
                      addSuffix: true,
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
