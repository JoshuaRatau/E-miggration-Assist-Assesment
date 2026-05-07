import { createHmac, timingSafeEqual } from "node:crypto";
import { db, unsubscribesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { normalizeWhatsapp } from "./whatsapp";

// Phase 4 — Global, per-channel unsubscribe registry.
//
// Tokens are HMAC-signed (not random opaque) so the GET /unsubscribe handler
// can recover the (channel, contact) pair without a DB lookup, but cannot be
// forged without the server secret. This means:
//   * One-click unsubscribes are stateless until the moment they POST — no
//     pre-issued token row to garbage-collect.
//   * The same token always resolves to the same contact — replay-safe
//     (the DB UNIQUE on (contact_type, contact) makes the second insert a
//     harmless conflict).
// The token is intentionally URL-safe (base64url) and fixed-length so it can
// be embedded in a one-line email footer without wrapping.

const SECRET = (() => {
  const v = process.env.UNSUBSCRIBE_SECRET ?? process.env.SESSION_SECRET;
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "UNSUBSCRIBE_SECRET (or SESSION_SECRET) must be set in production",
    );
  }
  return "dev-only-unsubscribe-secret-do-not-use-in-prod";
})();

export type UnsubscribeChannel = "email" | "whatsapp";

/**
 * Canonicalize a contact value before storing OR comparing.
 *
 * Email   → trim + lowercase.
 * WhatsApp → E.164 with leading '+' (delegates to existing `normalizeWhatsapp`).
 *
 * Returns null for invalid input — callers should skip rather than store
 * un-normalizeable values; an unsubscribe row with a malformed contact would
 * silently fail to match later.
 */
export function canonicalContact(
  channel: UnsubscribeChannel,
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (channel === "email") {
    // Lowercase covers the ~99% case; we don't strip the +alias suffix
    // because users legitimately use it as a deliverability tag.
    return trimmed.toLowerCase();
  }
  return normalizeWhatsapp(trimmed);
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64urlDecode(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replaceAll("-", "+").replaceAll("_", "/") + pad, "base64");
}

/**
 * Mint a one-click unsubscribe token.  Format: `${payload}.${sig}` where
 * `payload` is base64url(JSON({c, v})) and `sig` is the first 16 bytes of
 * HMAC-SHA256(payload, SECRET) — 16 bytes is enough collision resistance
 * for a fire-and-forget unsubscribe link and keeps the URL short.
 */
export function mintUnsubscribeToken(
  channel: UnsubscribeChannel,
  contact: string,
): string {
  const canonical = canonicalContact(channel, contact);
  if (!canonical) throw new Error("cannot mint token for invalid contact");
  const payload = b64url(
    Buffer.from(JSON.stringify({ c: channel, v: canonical })),
  );
  const sig = b64url(
    createHmac("sha256", SECRET).update(payload).digest().subarray(0, 16),
  );
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { channel: UnsubscribeChannel; contact: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(
    createHmac("sha256", SECRET).update(payload).digest().subarray(0, 16),
  );
  // Constant-time comparison — both buffers must be the same length so we
  // bail before `timingSafeEqual` would throw.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("c" in parsed) ||
    !("v" in parsed)
  ) {
    return null;
  }
  const channel = (parsed as { c: unknown }).c;
  const contact = (parsed as { v: unknown }).v;
  if (
    (channel !== "email" && channel !== "whatsapp") ||
    typeof contact !== "string"
  ) {
    return null;
  }
  return { channel, contact };
}

/**
 * Idempotent insert. Returns true if a NEW row was created, false if the
 * contact was already on the list (treated as success by all callers).
 */
export async function recordUnsubscribe(args: {
  channel: UnsubscribeChannel;
  contact: string;
  source: "link" | "wa_stop" | "manual" | "operator";
  reason?: string | null;
  unsubscribedBy?: string | null;
}): Promise<boolean> {
  const canonical = canonicalContact(args.channel, args.contact);
  if (!canonical) return false;
  const inserted = await db
    .insert(unsubscribesTable)
    .values({
      contactType: args.channel,
      contact: canonical,
      source: args.source,
      reason: args.reason ?? null,
      unsubscribedBy: args.unsubscribedBy ?? null,
    })
    .onConflictDoNothing({
      target: [unsubscribesTable.contactType, unsubscribesTable.contact],
    })
    .returning({ id: unsubscribesTable.id });
  return inserted.length > 0;
}

export async function isUnsubscribed(
  channel: UnsubscribeChannel,
  contact: string | null | undefined,
): Promise<boolean> {
  const canonical = canonicalContact(channel, contact);
  if (!canonical) return false;
  const rows = await db
    .select({ id: unsubscribesTable.id })
    .from(unsubscribesTable)
    .where(
      and(
        eq(unsubscribesTable.contactType, channel),
        eq(unsubscribesTable.contact, canonical),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Bulk presence check used by the campaign send path. Returns the SUBSET of
 * `contacts` that are already unsubscribed (canonicalized internally). One
 * round-trip regardless of audience size — the per-row `isUnsubscribed`
 * helper would be O(N) trips otherwise.
 */
export async function findUnsubscribed(
  channel: UnsubscribeChannel,
  contacts: ReadonlyArray<string | null | undefined>,
): Promise<Set<string>> {
  const canon = new Set<string>();
  for (const c of contacts) {
    const v = canonicalContact(channel, c);
    if (v) canon.add(v);
  }
  if (canon.size === 0) return new Set();
  const rows = await db
    .select({ contact: unsubscribesTable.contact })
    .from(unsubscribesTable)
    .where(
      and(
        eq(unsubscribesTable.contactType, channel),
        inArray(unsubscribesTable.contact, [...canon]),
      ),
    );
  return new Set(rows.map((r) => r.contact));
}

export function buildUnsubscribeUrl(
  baseUrl: string,
  channel: UnsubscribeChannel,
  contact: string,
): string {
  const token = mintUnsubscribeToken(channel, contact);
  // Trim trailing slash so we always emit a clean `/api/unsubscribe?token=…`.
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}
