// Saved Views — per-operator filter presets persisted in localStorage.
//
// A saved view captures the entire dashboard filter state (segment +
// status + priority + whatsapp + sort) under an operator-chosen name,
// so e.g. "Hot B2B" or "My overdue" can be restored with one click.
//
// Storage is local-only (no server round-trip) for two reasons:
//   1. Per-device, per-operator personalisation — what a sales rep
//      considers their working view rarely matches what an ops lead does.
//   2. Zero schema/migration cost — the moment we want to share views
//      across operators we'll lift them into the DB; until then this is
//      pure client state.
//
// Versioned (`v` field) so a future shape change can detect & discard
// stale entries without throwing in JSON.parse.

export type SavedViewFilters = {
  segment: "ALL" | "individual" | "professional";
  status: string; // "ALL" | one of the lead_status enum values
  priority: string; // "ALL" | "critical" | "high" | "medium" | "low"
  whatsapp: "ANY" | "HAS" | "NONE";
  sort: "newest" | "priority" | "score";
};

export type SavedView = {
  id: string;
  name: string;
  filters: SavedViewFilters;
  createdAt: string;
  v: 1;
};

const STORAGE_KEY = "ema:admin:savedViews";

// Two built-in presets that ship with the dashboard so an operator
// landing fresh isn't staring at an empty tab strip. They're rendered
// inline ahead of any user-saved views and cannot be edited or
// deleted (the UI hides those affordances when `isBuiltin` is true).
export const BUILTIN_VIEWS: ReadonlyArray<SavedView & { isBuiltin: true }> = [
  {
    id: "builtin:hot-b2b",
    name: "Hot B2B",
    isBuiltin: true,
    v: 1,
    createdAt: "1970-01-01T00:00:00.000Z",
    filters: {
      segment: "professional",
      status: "ALL",
      priority: "ALL",
      whatsapp: "ANY",
      sort: "score",
    },
  },
  {
    id: "builtin:new-individuals",
    name: "New individuals",
    isBuiltin: true,
    v: 1,
    createdAt: "1970-01-01T00:00:00.000Z",
    filters: {
      segment: "individual",
      status: "new",
      priority: "ALL",
      whatsapp: "ANY",
      sort: "newest",
    },
  },
];

export function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — drop anything that doesn't look like a v1
    // SavedView so a corrupted entry can't crash the dashboard render.
    return parsed.filter(
      (v): v is SavedView =>
        typeof v === "object" &&
        v !== null &&
        (v as SavedView).v === 1 &&
        typeof (v as SavedView).id === "string" &&
        typeof (v as SavedView).name === "string" &&
        typeof (v as SavedView).filters === "object" &&
        (v as SavedView).filters !== null,
    );
  } catch {
    return [];
  }
}

export function persistSavedViews(views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Quota / private-mode failures are non-fatal — the saved view just
    // won't survive a reload. Surfacing a toast here is overkill.
  }
}

// Compare two filter states for exact equality. Used by the views bar
// to highlight which preset (if any) matches the current filters.
export function filtersEqual(
  a: SavedViewFilters,
  b: SavedViewFilters,
): boolean {
  return (
    a.segment === b.segment &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.whatsapp === b.whatsapp &&
    a.sort === b.sort
  );
}

export function makeId(): string {
  return `view_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
