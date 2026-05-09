/**
 * Phase 6D-1 — Idempotent template-library bootstrap.
 *
 * Runs once on server boot (after admin bootstrap, before the route
 * mounting loop matters). For every entry in `SEED_COMM_TEMPLATES`,
 * inserts a row in `comm_templates` only if no row with the same
 * `name` already exists. This means:
 *
 *   - First boot of a fresh database  → all 20 templates appear.
 *   - Re-boot                         → no-op, nothing duplicated.
 *   - Operator edits a seeded template → preserved (we match on name,
 *                                       not content; if the operator
 *                                       renames, the seed re-appears
 *                                       on next boot — intentional, so
 *                                       the library stays complete).
 *   - Operator archives a seeded one  → we skip it (archived rows
 *                                       still occupy the name).
 *
 * The function never throws; it logs and continues so a transient
 * Postgres hiccup at startup can't crash the whole API.
 */

import { db, commTemplatesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";
import { SEED_COMM_TEMPLATES } from "./seedCommTemplates";

export type BootstrapTemplatesResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

export async function bootstrapCommTemplates(): Promise<BootstrapTemplatesResult> {
  try {
    const seedNames = SEED_COMM_TEMPLATES.map((t) => t.name);

    // Single round-trip to find which names already exist (any state,
    // including archived). Avoids a 20-shot N+1 against pg.
    const existing = await db
      .select({ name: commTemplatesTable.name })
      .from(commTemplatesTable)
      .where(inArray(commTemplatesTable.name, seedNames));
    const existingNames = new Set(existing.map((r) => r.name));

    const toInsert = SEED_COMM_TEMPLATES.filter(
      (t) => !existingNames.has(t.name),
    );
    if (toInsert.length === 0) {
      logger.info(
        { totalSeed: SEED_COMM_TEMPLATES.length },
        "templateBootstrap: all seed templates already present, skipping",
      );
      return { ok: true, inserted: 0, skipped: SEED_COMM_TEMPLATES.length };
    }

    await db.insert(commTemplatesTable).values(
      toInsert.map((t) => ({
        name: t.name,
        category: t.category,
        channel: t.channel,
        subject: t.subject,
        body: t.body,
        // createdBy/updatedBy are nullable soft-refs — leaving NULL
        // marks these as system-seeded rather than operator-authored.
        createdBy: null,
        updatedBy: null,
      })),
    );
    logger.info(
      { inserted: toInsert.length, skipped: existingNames.size },
      "templateBootstrap: seeded default communication templates",
    );
    return {
      ok: true,
      inserted: toInsert.length,
      skipped: existingNames.size,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: message },
      "templateBootstrap: failed to seed default templates (continuing — operators can re-trigger from the Templates page)",
    );
    return { ok: false, error: message };
  }
}
