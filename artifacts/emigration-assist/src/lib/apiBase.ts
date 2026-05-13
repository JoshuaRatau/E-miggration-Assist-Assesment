// Centralised resolver for the API origin used by every fetch in the app.
//
// Two scenarios:
//   1. Same-origin (Replit dev / Replit prod): the web app and API share
//      a host via the shared proxy. `VITE_API_URL` is unset, so we fall
//      back to `BASE_URL` (the Vite-injected sub-path the artifact is
//      mounted at, e.g. "/").
//   2. Cross-origin (Vercel frontend → Replit API): set
//      `VITE_API_URL=https://<your-replit-app>` at build time on Vercel.
//      All API calls are then absolute against that origin.
//
// All values are normalised to NOT end in a slash so callers can safely
// concatenate `${API_BASE}/api/...`.
const raw = import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL ?? "/";
export const API_BASE = raw.replace(/\/$/, "");

/**
 * Build a full API URL from a path that should start with `/api/...`.
 *   apiUrl("/api/leads") => "https://api.example.com/api/leads"
 *   apiUrl("api/leads")  => "https://api.example.com/api/leads"
 */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}
