import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db, leadOtpsTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export interface VerifiedOtp {
  id: string;
  channel: "email" | "whatsapp";
  email: string | null;
  whatsapp: string | null;
  consumedAt: Date;
}

/**
 * Looks up a verified OTP row that is still inside the lead-creation window.
 * Returns null if the row does not exist, was never consumed, or the
 * verification is older than `OTP_VERIFICATION_WINDOW_MS` (30 min).
 */
export async function findUsableVerifiedOtp(
  otpId: string,
): Promise<VerifiedOtp | null> {
  const cutoff = new Date(Date.now() - OTP_VERIFICATION_WINDOW_MS);
  const rows = await db
    .select()
    .from(leadOtpsTable)
    .where(
      and(
        eq(leadOtpsTable.id, otpId),
        gt(leadOtpsTable.consumedAt, cutoff),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.consumedAt) return null;
  if (row.channel !== "email" && row.channel !== "whatsapp") return null;
  return {
    id: row.id,
    channel: row.channel,
    email: row.email,
    whatsapp: row.whatsapp,
    consumedAt: row.consumedAt,
  };
}
