/**
 * Tiny in-memory sliding-window rate limiter.
 *
 * Per-key timestamps array; on each `hit(key)` we drop entries older than
 * the window and compare the remaining count to the limit. Memory is
 * bounded by a periodic sweep that drops empty keys every minute.
 *
 * This is a single-process limiter — sufficient for the pre-launch volume
 * on a single Replit VM. If the API ever scales horizontally, swap this
 * for a Redis-backed counter; the call sites do not need to change.
 */

export interface RateBucketConfig {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum hits allowed within the window per key. */
  max: number;
}

export interface RateBucket {
  hit(key: string): { ok: true } | { ok: false; retryAfterSec: number };
}

export function createRateBucket(cfg: RateBucketConfig): RateBucket {
  const store = new Map<string, number[]>();

  const sweep = () => {
    const cutoff = Date.now() - cfg.windowMs;
    for (const [key, hits] of store.entries()) {
      const fresh = hits.filter((t) => t > cutoff);
      if (fresh.length === 0) store.delete(key);
      else if (fresh.length !== hits.length) store.set(key, fresh);
    }
  };
  setInterval(sweep, 60_000).unref();

  return {
    hit(key) {
      const now = Date.now();
      const cutoff = now - cfg.windowMs;
      const hits = (store.get(key) ?? []).filter((t) => t > cutoff);
      if (hits.length >= cfg.max) {
        const oldest = hits[0]!;
        const retryAfterSec = Math.max(
          1,
          Math.ceil((oldest + cfg.windowMs - now) / 1000),
        );
        return { ok: false, retryAfterSec };
      }
      hits.push(now);
      store.set(key, hits);
      return { ok: true };
    },
  };
}
