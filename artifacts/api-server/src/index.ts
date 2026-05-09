import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapAdminAccounts } from "./lib/adminBootstrap";
import { startScoreWorker } from "./lib/scoreWorker";

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

  // Phase 6B — start the in-process tier-aware score recompute worker.
  // Backfills `lead_created` events for historical rows on first run,
  // then ticks every 60s. Single-instance design (single-replica deploy).
  startScoreWorker().catch((err) => {
    logger.error({ err }, "scoreWorker: start failed");
  });
});
