import { PgBoss, type Job } from "pg-boss";
import { logger } from "./logger";
import {
  handleCampaignSendJob,
  type CampaignSendJobData,
} from "./campaignSendWorker";

// Phase 6D-3A — pg-boss durable job queue.
//
// Single in-process boss instance (api-server is single-replica). The boss
// auto-creates its own `pgboss` schema on first start; no Drizzle migration
// required. Workers run inside the API process — no separate worker
// deployment.
//
// Queue: `campaign-recipient-send` — one job per recipient. Concurrency is
// capped at 8 in-flight jobs to stay under provider rate limits (Resend
// ~10/s sustained; Twilio WA ~1/s per number). Failures are retried twice
// with exponential backoff before the recipient row is marked failed.

export const QUEUE_CAMPAIGN_SEND = "campaign-recipient-send";

let boss: PgBoss | null = null;
let starting: Promise<void> | null = null;

export function getQueue(): PgBoss {
  if (!boss) {
    throw new Error(
      "Queue not started. Call startQueue() during boot before enqueueing jobs.",
    );
  }
  return boss;
}

/** True iff the queue has finished starting and is ready to accept jobs. */
export function isQueueReady(): boolean {
  return boss !== null;
}

export async function startQueue(): Promise<void> {
  if (boss) return;
  if (starting) return starting;

  starting = (async () => {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to start the job queue");
    }

    const instance = new PgBoss({
      connectionString,
      schema: "pgboss",
    });

    instance.on("error", (err: unknown) => {
      logger.error({ err }, "pg-boss error");
    });

    await instance.start();
    await instance.createQueue(QUEUE_CAMPAIGN_SEND);

    await instance.work<CampaignSendJobData>(
      QUEUE_CAMPAIGN_SEND,
      {
        // 8 jobs in flight per process. Per-fetch batchSize matches so
        // the polling loop pulls a fresh batch as workers free up.
        batchSize: 8,
        pollingIntervalSeconds: 1,
      },
      async (jobs: Job<CampaignSendJobData>[]) => {
        // pg-boss v12 hands the worker an array. Process each job
        // independently and NEVER rethrow batch-wide — a single failure
        // would otherwise force pg-boss to retry the whole batch, but
        // already-processed jobs in the batch have a claimed recipient
        // row whose retry no-ops (claim requires `status='queued'`),
        // and the rethrow gives no useful retry semantics for the
        // failing job either (handleCampaignSendJob already settles
        // post-claim exceptions to `failed` internally — see worker).
        // Architect-flagged: log and continue.
        for (const job of jobs) {
          try {
            await handleCampaignSendJob(job.data);
          } catch (err) {
            logger.error(
              { err, jobId: job.id, data: job.data },
              "campaign-send job handler threw at queue level; swallowing to keep batch healthy",
            );
          }
        }
      },
    );

    boss = instance;
    logger.info(
      { queue: QUEUE_CAMPAIGN_SEND, batchSize: 8 },
      "Job queue started",
    );
  })();

  try {
    await starting;
  } finally {
    starting = null;
  }
}

export async function stopQueue(): Promise<void> {
  if (!boss) return;
  try {
    await boss.stop({ graceful: true, timeout: 30_000 });
  } catch (err) {
    logger.warn({ err }, "pg-boss stop failed");
  } finally {
    boss = null;
  }
}

export async function enqueueCampaignSends(
  jobs: CampaignSendJobData[],
): Promise<void> {
  if (jobs.length === 0) return;
  const b = getQueue();
  // Batch insert is one round-trip regardless of job count — critical at
  // the new 2000 cap (would otherwise be 2000 INSERTs).
  // Per-job retry policy lives on the JobInsert (pg-boss v12 moved retry
  // config off ConstructorOptions). After 2 retries with exponential
  // backoff, the job lands in `failed`; the worker's atomic `queued`
  // claim ensures retries can never double-send.
  await b.insert(
    QUEUE_CAMPAIGN_SEND,
    jobs.map((data) => ({
      name: QUEUE_CAMPAIGN_SEND,
      data,
      retryLimit: 2,
      retryBackoff: true,
      expireInSeconds: 60 * 60,
    })),
  );
}
