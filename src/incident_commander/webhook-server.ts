import fs from "node:fs";
import path from "node:path";
import { createRazorpayWebhookServer, RazorpayWebhookInbox } from "./webhook";

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

const port = Number(process.env.PORT ?? "9999");

const statePath = path.resolve(
  process.env.RAZORPAY_WEBHOOK_STATE ?? ".runtime/razorpay-webhooks.sqlite3",
);
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const inbox = new RazorpayWebhookInbox(statePath.replace(/\.sqlite3$/, ".json"));
const server = createRazorpayWebhookServer(inbox, { webhookSecret: secret });

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

function shutdown() { server.close(); }
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
