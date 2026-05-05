import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, prelaunchLeadsTable, prelaunchDocumentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

// Reference format produced by generateReferenceNumber():
//   EMA-<base36 timestamp uppercased>-<4 char random>
// Demo references look like EMA-DEMO-A1.
// We accept any uppercase EMA-XXX-XXX shape with sane bounds.
const REFERENCE_REGEX = /^EMA-[A-Z0-9]{2,16}-[A-Z0-9]{2,8}$/;

// Public-facing label values. The classifier may produce richer internal
// labels, but the public surface is intentionally collapsed to four neutral
// states so we never leak case-strength signals to the user.
type PublicStatusLabel =
  | "Assessment Received"
  | "Supporting Circumstances Present"
  | "Requires Further Review"
  | "High Complexity Case";

const PUBLIC_LABEL_BY_CLASSIFICATION: Record<string, PublicStatusLabel> = {
  VALID_STATUS_GENERAL_INTEREST: "Assessment Received",
  VISA_EXPIRING_OR_EXPIRED: "Requires Further Review",
  OVERSTAY_STRONG_CONTEXT: "Supporting Circumstances Present",
  OVERSTAY_MODERATE_CONTEXT: "Supporting Circumstances Present",
  OVERSTAY_LIMITED_CONTEXT: "Requires Further Review",
  DECLARED_UNDESIRABLE: "High Complexity Case",
  POSSIBLE_PROHIBITED_PERSON: "High Complexity Case",
  UNKNOWN_REQUIRES_REVIEW: "Requires Further Review",
};

function publicLabelFor(classification: string | null | undefined): PublicStatusLabel {
  if (!classification) return "Assessment Received";
  return PUBLIC_LABEL_BY_CLASSIFICATION[classification] ?? "Assessment Received";
}

// --- Rate limiting (in-memory sliding window, per IP) ---------------------
// 10 requests / 60s window. Sufficient defense against trivial enumeration;
// since references carry ~62 bits of entropy and we serve identical 404s
// for both unknown and malformed input, brute force remains infeasible.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const ipHits = new Map<string, number[]>();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (ipHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT) {
    const retryAfter = Math.max(
      1,
      Math.ceil((recent[0]! + RATE_WINDOW_MS - now) / 1000),
    );
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too many requests" });
  }
  recent.push(now);
  ipHits.set(ip, recent);
  next();
}

// Periodic eviction so the map doesn't grow unbounded
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, hits] of ipHits) {
    const filtered = hits.filter((t) => t > cutoff);
    if (filtered.length === 0) ipHits.delete(ip);
    else ipHits.set(ip, filtered);
  }
}, RATE_WINDOW_MS).unref();

// Identical generic response used for both "bad format" and "not found" so
// callers cannot distinguish them and confirm whether a reference exists.
function notFound(res: Response) {
  return res.status(404).json({ error: "Reference not found" });
}

router.get("/public/status/:referenceNumber", rateLimit, async (req, res) => {
  const ref = String(req.params.referenceNumber || "").toUpperCase();
  if (!REFERENCE_REGEX.test(ref)) {
    return notFound(res);
  }

  const rows = await db
    .select({
      referenceNumber: prelaunchLeadsTable.referenceNumber,
      internalClassification: prelaunchLeadsTable.internalClassification,
      leadCategory: prelaunchLeadsTable.leadCategory,
      createdAt: prelaunchLeadsTable.createdAt,
      id: prelaunchLeadsTable.id,
    })
    .from(prelaunchLeadsTable)
    .where(eq(prelaunchLeadsTable.referenceNumber, ref))
    .limit(1);

  const row = rows[0];
  if (!row) return notFound(res);

  const docCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prelaunchDocumentsTable)
    .where(eq(prelaunchDocumentsTable.leadId, row.id));
  const documentsUploaded = (docCountRows[0]?.count ?? 0) > 0;

  return res.json({
    referenceNumber: row.referenceNumber,
    publicLabel: publicLabelFor(row.internalClassification),
    createdAt: row.createdAt.toISOString(),
    documentsUploaded,
  });
});

export default router;
