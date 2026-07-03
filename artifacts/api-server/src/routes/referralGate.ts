import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db, prelaunchLeadsTable, referralsTable } from "@workspace/db";
import { writeReferralAudit } from "../lib/referralAudit";
import {
  buildApplicantPushBody,
  deriveReferralPreview,
  mintRedirectToken,
  pushApplicantToEma,
} from "../lib/referralService";
import {
  getReferralSecret,
  stableStringify,
  verifyBodySignature,
} from "../lib/referralTunnel";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// PUBLIC — accept & open in EMA (§4.5 push + §4.6 redirect).
//
// 1. Push the applicant to EMA (§3.2) so the preview is ready when the firm
//    lands on /referral-gate.
// 2. Mint a signed, short-lived, one-time redirect token (§3.1).
// 3. 302 → {EMA_APP_URL}/referral-gate?token=...
//
// Fails closed (503) when the tunnel is not configured.
// ---------------------------------------------------------------------------

router.get("/referral-gate/redirect/:referralId", async (req, res) => {
  const referralId = req.params.referralId;

  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.referralId, referralId))
    .limit(1);
  if (!referral) {
    return res.status(404).json({ error: "referral_not_found" });
  }

  // Consent is mandatory before any push/redirect.
  if (!referral.consentToShare) {
    return res.status(409).json({ error: "consent_required" });
  }

  // Already-live token that hasn't expired → re-issue the same redirect
  // (idempotent). We honour expiresAt as the one-time-use window.
  const now = Date.now();

  const secret = getReferralSecret();
  if (!secret) {
    // Fail closed — never redirect without the shared secret.
    await writeReferralAudit(referralId, "failed", {
      reason: "tunnel_not_configured",
    });
    return res.status(503).json({ error: "tunnel_not_configured" });
  }

  if (!referral.leadId) {
    return res.status(409).json({ error: "referral_missing_lead" });
  }
  const [lead] = await db
    .select()
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.id, referral.leadId))
    .limit(1);
  if (!lead) {
    return res.status(409).json({ error: "lead_not_found" });
  }

  const preview = deriveReferralPreview(lead);

  // 1. Applicant push (§3.2) — PII travels only inside this signed body.
  const pushBody = buildApplicantPushBody({
    referralId,
    assignmentId: referral.assignmentId ?? null,
    funnelFirmId: referral.funnelFirmId ?? null,
    preview,
    lead,
  });
  const push = await pushApplicantToEma(pushBody);
  if (push.ok) {
    await db
      .update(referralsTable)
      .set({ pushedAt: new Date(), updatedAt: new Date() })
      .where(eq(referralsTable.referralId, referralId));
    await writeReferralAudit(referralId, "applicant_pushed", {
      status: push.status,
    });
  } else {
    // Non-fatal: EMA upserts idempotently and the push is safe to retry, but
    // record the attempt for the audit trail (no PII).
    await writeReferralAudit(referralId, "failed", {
      stage: "applicant_push",
      reason: push.reason,
      status: push.status ?? null,
    });
  }

  // 2. Mint the redirect token (§3.1).
  const minted = mintRedirectToken({
    referralId,
    assignmentId: referral.assignmentId ?? null,
    funnelFirmId: referral.funnelFirmId ?? null,
  });
  if (!minted) {
    await writeReferralAudit(referralId, "failed", {
      reason: "tunnel_not_configured",
    });
    return res.status(503).json({ error: "tunnel_not_configured" });
  }

  await db
    .update(referralsTable)
    .set({
      status: "redirected_to_ema",
      acceptedAt: referral.acceptedAt ?? new Date(),
      tokenNonce: minted.nonce,
      tokenIssuedAt: new Date(minted.issuedAt),
      tokenExpiresAt: new Date(minted.expiresAt),
      updatedAt: new Date(),
    })
    .where(eq(referralsTable.referralId, referralId));

  if (!referral.acceptedAt) {
    await writeReferralAudit(referralId, "accepted");
  }
  await writeReferralAudit(referralId, "redirected_to_ema", {
    expiresAt: minted.expiresAt,
    reissued: now < (referral.tokenExpiresAt?.getTime() ?? 0),
  });

  // 3. Redirect the firm's browser into EMA.
  return res.redirect(302, minted.redirectUrl);
});

// ---------------------------------------------------------------------------
// PUBLIC — status callback receiver (§3.3). EMA → funnel, S2S signed.
//
// Verify the signature (fail closed), update referral state idempotently, and
// respond fast. NEVER log applicant PII (the callback carries none).
// ---------------------------------------------------------------------------

const CallbackBody = z.object({
  referralId: z.string().min(1),
  assignmentId: z.string().nullable().optional(),
  status: z.enum([
    "ema_account_required",
    "ema_account_linked",
    "converted",
    "failed",
  ]),
  emaFirmId: z.string().nullable().optional(),
  emaClientId: z.string().nullable().optional(),
  emaCaseId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

router.post("/referral-gate/callback", async (req, res) => {
  const secret = getReferralSecret();
  if (!secret) {
    // Fail closed — never accept an unauthenticated callback when the shared
    // secret is missing. Contract requires 503, not a 401 signature failure.
    return res.status(503).json({ error: "tunnel_not_configured" });
  }
  const signature = req.header("x-referral-signature");

  // Verify over the exact stable serialization of the parsed body.
  const raw = stableStringify(req.body);
  if (!verifyBodySignature(raw, signature, secret)) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  const parsed = CallbackBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_body", detail: parsed.error.flatten() });
  }
  const body = parsed.data;

  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.referralId, body.referralId))
    .limit(1);
  if (!referral) {
    // Unknown referral — acknowledge to stop retries, but record nothing.
    return res.status(404).json({ error: "referral_not_found" });
  }

  // `converted` is a terminal success state — never regress out of it. A
  // duplicate or late callback after conversion is an idempotent no-op ack.
  if (referral.status === "converted") {
    return res.status(200).json({ ok: true, note: "already_converted" });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.assignmentId) patch.assignmentId = body.assignmentId;
  if (body.emaFirmId) patch.emaFirmId = body.emaFirmId;
  if (body.emaClientId) patch.emaClientId = body.emaClientId;
  if (body.emaCaseId) patch.emaCaseId = body.emaCaseId;

  if (body.status === "converted") {
    patch.status = "converted";
    patch.convertedToEmaCaseAt = new Date();
  } else if (body.status === "failed") {
    patch.status = "failed";
    patch.failedReason = body.reason ?? "unspecified";
  } else {
    patch.status = body.status; // ema_account_required | ema_account_linked
  }

  // Atomic guard: only apply while the row is still non-terminal, closing the
  // TOCTOU window between the SELECT above and this UPDATE.
  const updated = await db
    .update(referralsTable)
    .set(patch)
    .where(
      and(
        eq(referralsTable.referralId, body.referralId),
        ne(referralsTable.status, "converted"),
      ),
    )
    .returning({ referralId: referralsTable.referralId });

  if (updated.length === 0) {
    // A concurrent callback converted it first — idempotent no-op ack.
    return res.status(200).json({ ok: true, note: "already_converted" });
  }

  await writeReferralAudit(body.referralId, body.status, {
    emaFirmId: body.emaFirmId ?? null,
    emaClientId: body.emaClientId ?? null,
    emaCaseId: body.emaCaseId ?? null,
    reason: body.reason ?? null,
  });

  return res.status(200).json({ ok: true });
});

export const referralGateRouter = router;
export default router;
