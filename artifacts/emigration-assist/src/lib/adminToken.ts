/**
 * Legacy back-compat shim for the original `x-admin-token` header flow.
 *
 * V3 replaces the shared-token gate with a real email+password login
 * (see `adminAuth.tsx`).  Auth is now driven by an httpOnly session
 * cookie, so the existing admin pages don't need to inject anything —
 * `fetch()` carries the cookie automatically on same-origin requests.
 *
 * To keep the diff small, this shim still exposes `getAdminToken()` /
 * `clearAdminToken()`:
 *   - `getAdminToken()` returns a non-empty placeholder so existing
 *     `if (!token) return;` guards still pass.
 *   - The placeholder is also sent as the `x-admin-token` header by
 *     existing call sites; the server-side gate prefers the session
 *     cookie and ignores the (non-matching) placeholder.
 *   - `clearAdminToken()` is wired to also redirect to `/admin/login`
 *     so a stale-cookie 401 forces a fresh sign-in.
 */

const STORAGE_KEY = "ema-admin-token";
const PLACEHOLDER = "cookie-auth";

export function getAdminToken(): string | null {
  // Always return the placeholder — real auth is the session cookie.
  return PLACEHOLDER;
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  // Surface the failure: bounce to login. Using window.location keeps
  // this dependency-free for files that aren't React components.
  if (typeof window !== "undefined") {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const here = window.location.pathname + window.location.search;
    const next = encodeURIComponent(
      here.replace(new RegExp(`^${base}`), "") || "/admin",
    );
    window.location.href = `${base}/admin/login?next=${next}`;
  }
}
