/** A saved lead is not a completed assessment until the server confirms it.
 * Kept free of UI state so failure/retry behaviour can be tested without a browser.
 */
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