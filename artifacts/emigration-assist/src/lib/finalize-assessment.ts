/** A saved lead is not a completed assessment until the server confirms it.
 * Kept free of UI state so failure/retry behaviour can be tested without a browser.
 */
export function confirmedIntake(body: unknown): { leadId: string; referenceNumber: string } {
  if (!body || typeof body !== "object" || !("leadId" in body) ||
    typeof body.leadId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.leadId) ||
    body.leadId === "00000000-0000-0000-0000-000000000000" ||
    !("referenceNumber" in body) || typeof body.referenceNumber !== "string" ||
    !body.referenceNumber.trim()) {
    throw new Error("Your submission could not be confirmed. Please try again.");
  }
  return { leadId: body.leadId, referenceNumber: body.referenceNumber };
}

/** Store only a request digest and random attempt token, never answers/identity.
 * Lost responses can retry the same payload after reload; changed answers get a
 * new attempt and remain subject to the existing duplicate registration policy.
 */
const attempts = new Map<string, { hash: string; id: string }>();
export async function withSubmissionAttempt<T extends Record<string, unknown>>(flow: string, payload: T): Promise<T & { submissionAttemptId: string }> {
  // A refreshed OTP proof must not turn a retry of the same saved answers into
  // a new logical attempt. The server still verifies the current OTP normally.
  const { verifiedOtpId: _proof, ...answers } = payload;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(answers)));
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  const key = `ema-submission-attempt:${flow}`;
  let prior = attempts.get(key);
  try {
    const saved = sessionStorage.getItem(key);
    if (!prior && saved) prior = JSON.parse(saved);
  } catch { /* In-memory retry remains available if browser storage is disabled. */ }
  const attempt = prior?.hash === hash && /^[0-9a-f-]{36}$/i.test(prior.id)
    ? prior : { hash, id: crypto.randomUUID() };
  attempts.set(key, attempt);
  try { sessionStorage.setItem(key, JSON.stringify(attempt)); } catch { /* Same-session memory fallback. */ }
  return { ...payload, submissionAttemptId: attempt.id };
}

export async function confirmAssessmentCompletion(
  endpoint: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Finalisation failed");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("finalized" in body) || body.finalized !== true)
    throw new Error("Finalisation not confirmed");
}