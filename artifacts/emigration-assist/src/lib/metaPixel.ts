/**
 * Meta Pixel helper.
 *
 * The base pixel snippet lives in `index.html` (it defines `window.fbq` and
 * fires the initial `PageView`). This module is a thin, safe wrapper for
 * firing the handful of STANDARD events that are relevant to this
 * immigration / visa assistance app.
 *
 * Rules:
 *  - NEVER throws / never blocks the UI. If the pixel is blocked (ad-blocker)
 *    or not yet loaded, calls are silently no-ops.
 *  - NEVER send personal or sensitive data (names, emails, phone numbers, ID
 *    or passport numbers, addresses, case details, document info). Only safe
 *    descriptive params (content_name, content_category, value, currency).
 *  - Payment / checkout / subscription / scheduling / registration events are
 *    intentionally NOT included — this app has no such functionality.
 */

type StandardEvent =
  | "PageView"
  | "ViewContent"
  | "Lead"
  | "SubmitApplication"
  | "Contact";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Fire a standard Meta Pixel event. Safe no-op if the pixel is unavailable. */
export function trackPixel(
  event: StandardEvent,
  params?: Record<string, string | number>,
): void {
  try {
    if (typeof window === "undefined") return;
    const fbq = window.fbq;
    if (typeof fbq !== "function") return;
    if (params && Object.keys(params).length > 0) {
      fbq("track", event, params);
    } else {
      fbq("track", event);
    }
  } catch {
    // Analytics must never break the app.
  }
}

/**
 * Fire a conversion event at most once per logical key, surviving a page
 * refresh (uses sessionStorage). Used for thank-you / confirmation surfaces
 * that can be revisited or reloaded with the same reference.
 */
export function trackPixelOncePersistent(
  key: string,
  event: StandardEvent,
  params?: Record<string, string | number>,
): void {
  try {
    const storageKey = `fbq_once_${key}`;
    if (typeof sessionStorage !== "undefined") {
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, "1");
    }
  } catch {
    // sessionStorage may be unavailable (private mode); fall through and fire.
  }
  trackPixel(event, params);
}
