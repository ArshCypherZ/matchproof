import fs from "node:fs";
import path from "node:path";
import { EvidenceGatherer, IncidentStore } from "./core";
import { createRazorpayWebhookServer, RazorpayWebhookInbox } from "./webhook";
import {
  QUEUE_NAMES,
  addWebhookIncidentJob,
  createQueueWorker,
  createQueues,
} from "../queue";

function loadLocalEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]!] === undefined)
      process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
  }
}

async function main() {
  loadLocalEnv();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET must be configured");
  const processorSecret = process.env.PROCESSOR_WEBHOOK_SECRET;
  if (!processorSecret)
    throw new Error("PROCESSOR_WEBHOOK_SECRET must be configured");

  const port = Number(process.env.PORT ?? "9999");

  const statePath = "postgresql";
  const store = new IncidentStore(statePath, false, processorSecret);
  await store.initialize();
  const inbox = new RazorpayWebhookInbox(store, {
    evidenceGatherer: new EvidenceGatherer(),
  });
  const queues = process.env.REDIS_URL ? createQueues() : undefined;
  // Consume the webhook jobs this server enqueues so accepted events become
  // incidents without a separate worker process. Jobs of other names are
  // bookkeeping enqueued by the dashboard batch API and complete as no-ops:
  // their progress records are written synchronously by that API.
  const worker = queues
    ? createQueueWorker(
        QUEUE_NAMES.incidentProcessing,
        async (job) => {
          if (job.name !== "process-webhook-event") return;
          const result = await inbox.process(String(job.data.eventId), {
            webhookSecret: secret,
            processorSecret,
          });
          console.log(
            JSON.stringify({
              event: "webhook_processed",
              job_id: job.id,
              status: result?.status ?? "stored_unmatched",
            }),
          );
        },
        { concurrency: 1, deadLetter: queues.deadLetter },
      )
    : undefined;
  worker?.worker.on("error", (error) => {
    console.log(
      JSON.stringify({
        event: "queue_worker_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  const server = createRazorpayWebhookServer(inbox, {
    webhookSecret: secret,
    processorSecret,
    ...(queues
      ? {
          dispatcher: {
            enqueueIncident: (eventId: string) =>
              addWebhookIncidentJob(queues, eventId),
          },
        }
      : {}),
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        status: "listening",
        port,
        path: "/webhooks/razorpay",
        statePath,
      }),
    );
  });

  function shutdown() {
    server.close(
      () => void Promise.all([store.close(), queues?.close(), worker?.close()]),
    );
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
