import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../apps/web/app/api/incidents/export/route";
import { IncidentStore } from "../src/incident_commander/store";
import { verifyBundle } from "../src/incident_commander/validation";

const secret = "test-prototype-secret";
let directory: string;
let store: IncidentStore;

// The route module resolves its incident store through a per-tenant cache, so
// each test points the environment at a fresh SQLite state file.
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "export-"));
  process.env.INCIDENT_STATE_PATH = path.join(directory, "incident.sqlite");
  store = new IncidentStore(
    process.env.INCIDENT_STATE_PATH,
    true,
    secret,
    "export-test",
  );
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  await fs.rm(directory, { recursive: true, force: true });
  process.env.INCIDENT_STATE_PATH = "";
});

const paidPending = await fs.readFile("fixtures/paid_pending.json", "utf8");

async function seedIncident(overrides: Record<string, unknown>) {
  await store.ingest({
    ...verifyBundle(JSON.parse(paidPending), secret),
    ...overrides,
  });
}

const request = (tenantId: string, query = "") =>
  GET(
    new Request(`http://localhost/api/incidents/export${query}`, {
      headers: { "x-tenant-id": tenantId },
    }),
  );

describe("incident CSV export", () => {
  it("emits the header row for an empty result", async () => {
    const response = await request("tenant-empty");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="exceptions-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const csv = await response.text();
    expect(csv.trim()).toBe(
      "incident_id,payment_id,order_id,incident_class,status,current_step,amount_minor,currency,started_at,updated_at,age_seconds,source_kind",
    );
  });

  it("exports a seeded incident and escapes values with commas and quotes", async () => {
    await seedIncident({ incident_id: 'inc_"quoted",id' });
    const response = await request("export-test", "?q=quoted");
    const csv = await response.text();
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    const row = lines[1];
    if (!row) throw new Error("exported row is missing");
    expect(row.startsWith('"inc_""quoted"",id"')).toBe(true);
    expect(row).toContain("paid_pending,pending");
  });

  it("keeps other tenants out of the export", async () => {
    await seedIncident({});
    const response = await request("another-tenant");
    const csv = await response.text();
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("returns 400 for an invalid query", async () => {
    const response = await request("export-test", "?page_size=1000");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_query");
  });
});
