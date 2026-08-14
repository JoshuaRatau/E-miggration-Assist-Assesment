import { describe, it, expect } from "vitest";
import { classifySyncResults, isProgressResult, isGenuineFailure } from "./metaSyncClassify.js";

// ---------------------------------------------------------------------------
// isProgressResult
// ---------------------------------------------------------------------------

describe("isProgressResult", () => {
  it('returns true for "ok"', () => {
    expect(isProgressResult("ok")).toBe(true);
  });

  it('returns true for "partial:" prefix', () => {
    expect(isProgressResult("partial: 5/10 FB metrics synced; permission_missing: page_fans")).toBe(true);
    expect(isProgressResult("partial: 3/6 IG metrics synced; errors: reach(rate_limited)")).toBe(true);
  });

  it("returns false for non-progress results", () => {
    for (const v of [
      "api_error: FB metrics unavailable",
      "permission_missing: all 10 FB metrics denied",
      "empty: FB insights returned no data for this period",
      "no facebook page connected",
      "no instagram account connected",
      "no ad account connected",
      "no connected content sources",
      "token_expired: access token revoked",
    ]) {
      expect(isProgressResult(v)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isGenuineFailure
// ---------------------------------------------------------------------------

describe("isGenuineFailure", () => {
  it('returns false for "ok"', () => {
    expect(isGenuineFailure("ok")).toBe(false);
  });

  it('returns false for "empty:" prefix', () => {
    expect(isGenuineFailure("empty: FB insights returned no data for this period")).toBe(false);
    expect(isGenuineFailure("empty: no campaigns or ads found")).toBe(false);
    expect(isGenuineFailure("empty: no posts or media found")).toBe(false);
  });

  it('returns false for "no " prefix (unconfigured source)', () => {
    expect(isGenuineFailure("no facebook page connected")).toBe(false);
    expect(isGenuineFailure("no instagram account connected")).toBe(false);
    expect(isGenuineFailure("no ad account connected")).toBe(false);
    expect(isGenuineFailure("no connected content sources")).toBe(false);
  });

  it('returns false for "token_expired" prefix (handled separately)', () => {
    expect(isGenuineFailure("token_expired: access token revoked")).toBe(false);
  });

  it("returns true for api_error, permission_missing, and partial failures", () => {
    expect(isGenuineFailure("api_error: FB metrics unavailable (impressions(api_error))")).toBe(true);
    expect(isGenuineFailure("permission_missing: all 10 FB metrics denied")).toBe(true);
    expect(isGenuineFailure("partial: 5/10 FB metrics synced; permission_missing: page_fans")).toBe(true);
    expect(isGenuineFailure("partial: 3/6 IG metrics synced; errors: reach(rate_limited)")).toBe(true);
  });

  it("returns true for sub-prefixed content failures", () => {
    expect(isGenuineFailure("fb:api_error: Page not found")).toBe(true);
    expect(isGenuineFailure("ig:api_error: Account not found")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifySyncResults — key scenarios
// ---------------------------------------------------------------------------

describe("classifySyncResults", () => {
  // Scenario 1 ---------------------------------------------------------------
  it("all-empty first sync: no progress, no error, runOk false", () => {
    const sections = {
      facebook_insights: "empty: FB insights returned no data for this period",
      instagram_insights: "empty: IG insights returned no data for this period",
      audience: "empty: no audience demographics returned (account may need ≥100 followers)",
      campaigns: "no ad account connected",
      lead_forms: "empty: no lead forms found",
      content: "empty: no posts or media found",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(false);
    expect(r.syncWarnings).toBe("");
    expect(r.runOk).toBe(false);
    // The orchestrator must NOT advance lastSyncedAt when anyProgress=false —
    // keeps the 90-day backfill window open for the next retry.
  });

  // Scenario 2 ---------------------------------------------------------------
  it("mixed: campaigns write data but FB/IG fail completely — warns, runOk false", () => {
    const sections = {
      facebook_insights: "api_error: FB metrics unavailable (impressions(api_error), reach(api_error))",
      instagram_insights: "api_error: IG metrics unavailable (impressions(api_error))",
      audience: "no instagram account connected",
      campaigns: "ok", // campaigns synced successfully
      lead_forms: "ok",
      content: "empty: no posts or media found",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(true);  // campaigns + lead_forms wrote rows
    expect(r.syncWarnings).not.toBe(""); // FB + IG api_error must be captured
    expect(r.syncWarnings).toContain("api_error: FB metrics unavailable");
    expect(r.syncWarnings).toContain("api_error: IG metrics unavailable");
    expect(r.runOk).toBe(false); // partial success is NOT reported as ok=true
  });

  // Scenario 3 ---------------------------------------------------------------
  it("fully successful sync: allOk true, runOk true, no warnings", () => {
    const sections = {
      facebook_insights: "ok",
      instagram_insights: "ok",
      audience: "ok",
      campaigns: "ok",
      lead_forms: "ok",
      content: "ok",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(true);
    expect(r.allOk).toBe(true);
    expect(r.syncWarnings).toBe("");
    expect(r.runOk).toBe(true);
  });

  // Scenario 4 ---------------------------------------------------------------
  it("partial FB/IG with permission errors: progress true, warns, runOk false", () => {
    const sections = {
      facebook_insights: "partial: 5/10 FB metrics synced; permission_missing: page_fans, page_impressions",
      instagram_insights: "ok",
      audience: "empty: no audience demographics returned (account may need ≥100 followers)",
      campaigns: "no ad account connected",
      lead_forms: "ok",
      content: "ok",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(true);
    expect(r.syncWarnings).toContain("permission_missing:");
    expect(r.runOk).toBe(false);
    expect(r.allOk).toBe(false);
  });

  // Scenario 5 ---------------------------------------------------------------
  it("partial FB/IG with rate-limit errors: progress true, warns, runOk false", () => {
    const sections = {
      facebook_insights: "partial: 7/10 FB metrics synced; errors: page_fans(rate_limited), reach(api_error)",
      instagram_insights: "ok",
      audience: "no instagram account connected",
      campaigns: "ok",
      lead_forms: "ok",
      content: "ok",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(true);
    expect(r.syncWarnings).toContain("partial:");
    expect(r.syncWarnings).toContain("rate_limited");
    expect(r.runOk).toBe(false);
  });

  // Scenario 6 ---------------------------------------------------------------
  it("total failure with permission errors: no progress, warns, runOk false", () => {
    const sections = {
      facebook_insights: "permission_missing: all 10 FB metrics denied",
      instagram_insights: "permission_missing: all 6 IG metrics denied",
      audience: "no instagram account connected",
      campaigns: "no ad account connected",
      lead_forms: "no facebook page connected",
      content: "no connected content sources",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(false);
    expect(r.syncWarnings).toContain("permission_missing:");
    expect(r.runOk).toBe(false);
  });

  // Scenario 7 — mixed content: FB fails, IG writes -----------------------------------
  it("mixed content (FB fails, IG writes): anyProgress true, warns, runOk false", () => {
    // syncContent returns "partial: 12 content items synced; fb:api_error: ..." when
    // totalWrites > 0 and one source failed.  isProgressResult must recognise this.
    const sections = {
      facebook_insights: "ok",
      instagram_insights: "ok",
      audience: "no instagram account connected",
      campaigns: "no ad account connected",
      lead_forms: "no facebook page connected",
      content: "partial: 12 content items synced; fb:api_error: Page not found",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(true);           // partial: is a progress result
    expect(r.syncWarnings).toContain("partial:");
    expect(r.syncWarnings).toContain("fb:api_error:");
    expect(r.runOk).toBe(false);               // warning present → not fully ok
  });

  // Scenario 8 — mixed content: IG fails, FB writes -----------------------------------
  it("mixed content (IG fails, FB writes): anyProgress true, warns, runOk false", () => {
    const sections = {
      facebook_insights: "ok",
      instagram_insights: "ok",
      audience: "no instagram account connected",
      campaigns: "no ad account connected",
      lead_forms: "no facebook page connected",
      content: "partial: 7 content items synced; ig:api_error: Could not fetch media",
    };
    const r = classifySyncResults(sections);
    expect(r.anyProgress).toBe(true);
    expect(r.syncWarnings).toContain("partial:");
    expect(r.syncWarnings).toContain("ig:api_error:");
    expect(r.runOk).toBe(false);
  });

  // Scenario 9 ---------------------------------------------------------------
  it("token_expired: tokenExpired flag set, not in syncWarnings", () => {
    const sections = {
      facebook_insights: "token_expired: access token revoked",
      instagram_insights: "token_expired: access token revoked",
      audience: "no instagram account connected",
      campaigns: "no ad account connected",
      lead_forms: "no facebook page connected",
      content: "no connected content sources",
    };
    const r = classifySyncResults(sections);
    expect(r.tokenExpired).toBe(true);
    expect(r.anyProgress).toBe(false);
    // token_expired is excluded from syncWarnings — it has its own connection branch
    expect(r.syncWarnings).toBe("");
  });
});
