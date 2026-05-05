/**
 * Admin token helper.
 *
 * The admin endpoints (PATCH /api/admin/leads/:id, POST /api/admin/email/update)
 * are gated by an `x-admin-token` header that must equal the server-side
 * `ADMIN_EMAIL_TOKEN` env var.  The token is cached in `sessionStorage` so the
 * operator only enters it once per browser tab.
 *
 * `getAdminToken()` returns the cached token, prompting once if absent.
 * `clearAdminToken()` is called on a 401 so the next attempt re-prompts.
 */

const STORAGE_KEY = "ema-admin-token";

export function getAdminToken(): string | null {
  let token = sessionStorage.getItem(STORAGE_KEY) ?? "";
  if (token) return token;

  const entered = window.prompt("Enter the admin token");
  if (entered === null) return null;
  token = entered.trim();
  if (!token) return null;
  sessionStorage.setItem(STORAGE_KEY, token);
  return token;
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
