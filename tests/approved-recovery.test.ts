import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "../src/db/sqlite-client";
import { merchantOrders } from "../src/db/sqlite-schema";
import { SqliteMerchantPlatformAdapter } from "../src/db/sqlite-merchant-platform-adapter";
import { IncidentStore, verifyBundle } from "../src/incident_commander/core";
import { executeApprovedRecovery } from "../src/incident_commander/approved-recovery";
import type { ProviderAfterstateAdapter } from "../src/incident_commander/afterstate-verifier";

const secret = "test-prototype-secret";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "app-approve-"));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const paidPendingBundle = () =>
  verifyBundle(
    JSON.parse(
      fs.readFileSync(path.resolve("fixtures/paid_pending.json"), "utf8"),
    ),
    secret,
  );

const settlementBundle = () =>
  verifyBundle(
    JSON.parse(
      fs.readFileSync(
        path.resolve("fixtures/settlement_exception.json"),
        "utf8",
      ),
    ),
    secret,
  );

const merchantAdapter = async (file: string) => {
  const connection = createSqliteDatabase(file);
  migrate(connection.db, { migrationsFolder: "drizzle-sqlite" });
  connection.db
    .insert(merchantOrders)
    .values({
      orderId: "order_paid_pending_001",
      paymentId: "pay_paid_pending_001",
      state: "pending",
      amountMinor: 1000,
      currency: "INR",
      createdAt: "2026-08-21T10:00:03.000Z",
      updatedAt: "2026-08-21T10:00:03.000Z",
    })
    .run();
  return new SqliteMerchantPlatformAdapter(connection.db);
};

const capturedPaymentProvider: ProviderAfterstateAdapter = {
  fetchPayment: async () => ({
    entity: "payment",
    id: "pay_paid_pending_001",
    status: "captured",
    captured: true,
    amount: 1000,
    currency: "INR",
    order_id: "order_paid_pending_001",
    invoice_id: null,
    amount_refunded: 0,
    refund_status: null,
    description: null,
    card_id: null,
    bank: null,
    wallet: null,
    vpa: null,
    email: null,
    contact: null,
    error_code: null,
    error_description: null,
    error_source: null,
    error_step: null,
    error_reason: null,
  }),
};

describe("approved recovery", () => {
  it("executes the bounded merchant repair and verifies the afterstate", async () => {
    const statePath = path.join(root, "incident.sqlite3");
    const store = new IncidentStore(statePath, true, secret, "tenant-approve");
    await store.initialize();
    await store.ingest(paidPendingBundle());
    const merchant = await merchantAdapter(path.join(root, "merchant.sqlite3"));
    const result = await executeApprovedRecovery({
      store,
      incidentId: "inc_paid_pending_001",
      tenantId: "tenant-approve",
      actor: "operator-test",
      merchant,
      provider: capturedPaymentProvider,
    });
    expect(result.status).toBe("executed");
    if (result.status !== "executed") throw new Error("repair did not execute");
    expect(result.outcome.status).toBe("reconciled");
    expect(result.afterstate.status).toBe("verified");
    expect(
      await merchant.fetchOrderState("order_paid_pending_001"),
    ).toMatchObject({ state: "paid" });
    const payment = await store.payment("pay_paid_pending_001");
    expect(payment?.state).toBe("paid");
    const progress = await store.progress("inc_paid_pending_001");
    expect(progress.map((entry) => entry.step)).toEqual(
      expect.arrayContaining(["execute", "observe", "close"]),
    );
    await store.close();
  });

  it("executes once; a repeated approval finds nothing left to repair", async () => {
    const statePath = path.join(root, "replay.sqlite3");
    const store = new IncidentStore(statePath, true, secret, "tenant-approve");
    await store.initialize();
    await store.ingest(paidPendingBundle());
    const merchant = await merchantAdapter(
      path.join(root, "merchant-replay.sqlite3"),
    );
    const options = {
      store,
      incidentId: "inc_paid_pending_001",
      tenantId: "tenant-approve",
      actor: "operator-test",
      merchant,
      provider: capturedPaymentProvider,
    };
    await executeApprovedRecovery(options);
    const replay = await executeApprovedRecovery(options);
    // The first repair made provider and merchant state agree, so the second
    // approval has no bounded repair left to authorize.
    expect(replay.status).toBe("nothing_to_approve");
    if (replay.status !== "nothing_to_approve")
      throw new Error("replay must be refused");
    expect(replay.resolution).toBe("no_action_required");
    expect(
      await merchant.fetchOrderState("order_paid_pending_001"),
    ).toMatchObject({ state: "paid" });
    await store.close();
  });

  it("refuses approval when reconciliation holds the incident for review", async () => {
    const statePath = path.join(root, "settlement.sqlite3");
    const store = new IncidentStore(statePath, true, secret, "tenant-approve");
    await store.initialize();
    await store.ingest(settlementBundle());
    const result = await executeApprovedRecovery({
      store,
      incidentId: "inc_settlement_exception_001",
      tenantId: "tenant-approve",
      actor: "operator-test",
      merchant: await merchantAdapter(
        path.join(root, "merchant-settlement.sqlite3"),
      ),
      provider: capturedPaymentProvider,
    });
    expect(result.status).toBe("nothing_to_approve");
    if (result.status !== "nothing_to_approve")
      throw new Error("settlement incident must not be approvable");
    expect(result.resolution).toBe("escalate");
    expect(result.reason.length).toBeGreaterThan(0);
    await store.close();
  });
});
