import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Lightweight password policy for admin accounts.
 * Used by both the bootstrap seed (rejects an obviously-weak override) and
 * the change-password / admin-reset endpoints.  Returns null if OK or a
 * user-readable error string.
 */
export function validatePasswordPolicy(plain: string): string | null {
  if (typeof plain !== "string") return "Password is required";
  if (plain.length < 10) return "Password must be at least 10 characters";
  if (!/[A-Za-z]/.test(plain)) return "Password must contain a letter";
  if (!/\d/.test(plain)) return "Password must contain a digit";
  return null;
}
