import {
  Queue,
  Worker,
  type JobsOptions,
  type Processor,
  type WorkerOptions,
} from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";

export const QUEUE_NAMES = {
  incidentProcessing: "incident-processing",
  evidenceGathering: "evidence-gathering",
  batchEvaluation: "batch-evaluation",
  deadLetter: "dead-letter",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type QueueJobData = Record<string, unknown>;

export type QueueConnectionOptions = {
  url?: string;
  connection?: RedisOptions;
};

const retryOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800, count: 10_000 },
};

// BullMQ reserves ":" as a separator inside job ids, so custom ids are
// joined with "-" and any ":" in the value itself is replaced.
function customJobId(prefix: string, value: string) {
  return `${prefix}-${value.replace(/:/g, "-")}`;
}

export function createQueueConnection(options: QueueConnectionOptions = {}) {
  const url = options.url ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    ...options.connection,
  } as never);
}

export function createQueues(options: QueueConnectionOptions = {}) {
  const connection = createQueueConnection(options);
  const queues = {
    incidentProcessing: new Queue(QUEUE_NAMES.incidentProcessing, {
      connection,
      defaultJobOptions: retryOptions,
    }),
    evidenceGathering: new Queue(QUEUE_NAMES.evidenceGathering, {
      connection,
      defaultJobOptions: retryOptions,
    }),
    batchEvaluation: new Queue(QUEUE_NAMES.batchEvaluation, {
      connection,
      defaultJobOptions: retryOptions,
    }),
    deadLetter: new Queue(QUEUE_NAMES.deadLetter, {
      connection,
      defaultJobOptions: { removeOnComplete: { age: 604_800, count: 50_000 } },
    }),
  };
  return {
    ...queues,
    connection,
    close: async () =>
      Promise.all(Object.values(queues).map((queue) => queue.close())).then(
        () => connection.quit(),
      ),
  };
}

export function addIncidentJob(
  queues: Pick<ReturnType<typeof createQueues>, "incidentProcessing">,
  incidentId: string,
  data: QueueJobData = {},
) {
  return queues.incidentProcessing.add(
    "process-incident",
    { incidentId, ...data },
    { ...retryOptions, jobId: customJobId("incident", incidentId) },
  );
}

export function addWebhookIncidentJob(
  queues: Pick<ReturnType<typeof createQueues>, "incidentProcessing">,
  eventId: string,
) {
  return queues.incidentProcessing.add(
    "process-webhook-event",
    { eventId },
    { ...retryOptions, jobId: customJobId("webhook", eventId) },
  );
}

export function addBatchJob(
  queues: Pick<ReturnType<typeof createQueues>, "batchEvaluation">,
  batchId: string,
  incidentIds: readonly string[],
) {
  return queues.batchEvaluation.add(
    "evaluate-batch",
    { batchId, incidentIds },
    { ...retryOptions, jobId: customJobId("batch", batchId) },
  );
}

export function addEvidenceJob(
  queues: Pick<ReturnType<typeof createQueues>, "evidenceGathering">,
  paymentId: string,
  idempotencyKey: string,
) {
  return queues.evidenceGathering.add(
    "gather-evidence",
    { paymentId, idempotencyKey },
    { ...retryOptions, jobId: customJobId("evidence", idempotencyKey) },
  );
}

export function createQueueWorker<T extends QueueJobData>(
  name: Exclude<QueueName, "dead-letter">,
  processor: Processor<T>,
  options: QueueConnectionOptions & {
    concurrency?: number;
    deadLetter?: ReturnType<typeof createQueues>["deadLetter"];
  } = {},
) {
  const connection = createQueueConnection(options);
  const worker = new Worker<T>(name, processor, {
    connection,
    concurrency: options.concurrency ?? 5,
    autorun: true,
  } satisfies WorkerOptions);
  if (options.deadLetter) {
    worker.on("failed", async (job, error) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      try {
        await publishDeadLetter(
          { deadLetter: options.deadLetter! },
          name,
          job.id ?? job.name,
          job.data,
          error,
        );
      } catch (publishError) {
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "dead_letter_publish_failed",
            queue: name,
            job_id: job.id ?? job.name,
            error:
              publishError instanceof Error
                ? publishError.message
                : String(publishError),
          }),
        );
      }
    });
  }
  return {
    worker,
    connection,
    close: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}

export async function publishDeadLetter(
  deadLetter: { deadLetter: { add: Queue["add"] } },
  queue: string,
  jobId: string,
  data: QueueJobData,
  error: unknown,
) {
  return deadLetter.deadLetter.add(
    "failed-job",
    {
      queue,
      jobId,
      data,
      error: error instanceof Error ? error.message : String(error),
    },
    { jobId: customJobId("dead-letter", `${queue}-${jobId}`) },
  );
}
