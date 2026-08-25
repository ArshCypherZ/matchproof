import fs from "node:fs";
import path from "node:path";
import { EvidenceGatherer, IncidentStore } from "./core";
import { createRazorpayWebhookServer, RazorpayWebhookInbox } from "./webhook";
import { addWebhookIncidentJob, createQueues } from "../queue";

function loadLocalEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]!] === undefined)
      process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
  }
}

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
  server.close(() => void Promise.all([store.close(), queues?.close()]));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
