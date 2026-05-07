import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BUILTIN_VIEWS,
  filtersEqual,
  loadSavedViews,
  makeId,
  persistSavedViews,
  type SavedView,
  type SavedViewFilters,
} from "@/lib/savedViews";

// Tab-strip of saved filter presets that sits above the leads table.
// Renders the two built-in views first, then any user-saved views,
// then a "+ Save current" affordance and (when on a custom view) a
// trash button to delete it.
//
// The bar is fully controlled by the parent: it never directly mutates
// dashboard state — it just calls `onApply` with a SavedViewFilters
// payload and lets the parent dispatch into its own setters. This keeps
// the source of truth single (admin.tsx's useState pieces) and avoids
// the classic two-source filter-state drift.
export function SavedViewsBar({
  currentFilters,
  onApply,
}: {
  currentFilters: SavedViewFilters;
  onApply: (f: SavedViewFilters) => void;
}) {
  const [userViews, setUserViews] = useState<SavedView[]>([]);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [draftName, setDraftName] = useState("");

  // Hydrate from localStorage on mount only — avoids re-reading on every
  // render, and matches the existing pattern used by leadTypeSegment
  // persistence in admin.tsx.
  useEffect(() => {
    setUserViews(loadSavedViews());
  }, []);

  const allViews: SavedView[] = [...BUILTIN_VIEWS, ...userViews];

  const activeId =
    allViews.find((v) => filtersEqual(v.filters, currentFilters))?.id ?? null;

  function handleSave() {
    const name = draftName.trim();
    if (!name) return;
    const next: SavedView = {
      id: makeId(),
      name,
      v: 1,
      createdAt: new Date().toISOString(),
      filters: currentFilters,
    };
    const updated = [...userViews, next];
    setUserViews(updated);
    persistSavedViews(updated);
    setDraftName("");
    setShowSaveInput(false);
  }

  function handleDelete(id: string) {
    const updated = userViews.filter((v) => v.id !== id);
    setUserViews(updated);
    persistSavedViews(updated);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2"
      data-testid="saved-views-bar"
    >
      <span className="text-xs font-medium text-muted-foreground mr-1">
        Views
      </span>
      {allViews.map((v) => {
        const isActive = v.id === activeId;
        const isBuiltin = "isBuiltin" in v && v.isBuiltin === true;
        return (
          <div key={v.id} className="flex items-center">
            <button
              type="button"
              data-testid={`saved-view-${v.id}`}
              data-active={isActive ? "true" : "false"}
              onClick={() => onApply(v.filters)}
              className={
                "rounded-full border px-3 py-1 text-xs transition " +
                (isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-background hover:bg-accent")
              }
            >
              {v.name}
            </button>
            {!isBuiltin && (
              <button
                type="button"
                aria-label={`Delete view ${v.name}`}
                data-testid={`saved-view-delete-${v.id}`}
                onClick={() => handleDelete(v.id)}
                className="ml-1 text-xs text-muted-foreground hover:text-destructive"
                title="Delete this view"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <div className="ml-auto flex items-center gap-2">
        {showSaveInput ? (
          <>
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setShowSaveInput(false);
                  setDraftName("");
                }
              }}
              placeholder="View name…"
              className="h-7 w-40 text-xs"
              data-testid="saved-view-name-input"
            />
            <Button
              size="sm"
              variant="default"
              onClick={handleSave}
              disabled={!draftName.trim()}
              data-testid="saved-view-confirm-save"
              className="h-7 text-xs"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowSaveInput(false);
                setDraftName("");
              }}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSaveInput(true)}
            data-testid="saved-view-save-current"
            className="h-7 text-xs"
          >
            + Save current
          </Button>
        )}
      </div>
    </div>
  );
}
