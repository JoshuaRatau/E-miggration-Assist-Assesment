import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapAdminAccounts } from "./lib/adminBootstrap";
import { bootstrapCommTemplates } from "./lib/templateBootstrap";
import { startScoreWorker } from "./lib/scoreWorker";
import { startQueue, stopQueue } from "./lib/queue";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Fire-and-forget: seeds a demo admin if `admin_users` is empty and
  // purges any expired sessions. Errors are logged but never crash the
  // server.
  bootstrapAdminAccounts().catch((err) => {
    logger.error({ err }, "Admin bootstrap failed");
  });

  // Phase 6D-1 — seed the default 20-template communications library on
  // first boot. Idempotent on `name`: re-runs are no-ops, operator
  // edits to seeded templates are preserved.
  bootstrapCommTemplates().catch((err) => {
    logger.error({ err }, "templateBootstrap: failed");
  });

  // Phase 6B — start the in-process tier-aware score recompute worker.
  // Backfills `lead_created` events for historical rows on first run,
  // then ticks every 60s. Single-instance design (single-replica deploy).
  startScoreWorker().catch((err) => {
    logger.error({ err }, "scoreWorker: start failed");
  });

  // Phase 6D-3A — start the pg-boss durable job queue. Auto-creates the
  // `pgboss` schema on first run and registers the campaign-send worker.
  // Single-replica deploy means jobs run in-process; no external worker.
  startQueue().catch((err) => {
    logger.error({ err }, "queue: start failed");
  });
});

// Graceful shutdown — let in-flight jobs finish before exiting.
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received; stopping queue");
  await stopQueue();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
