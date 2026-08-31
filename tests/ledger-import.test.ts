import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "../src/db/sqlite-client";
import { merchantOrders } from "../src/db/sqlite-schema";
import { SqliteMerchantPlatformAdapter } from "../src/db/sqlite-merchant-platform-adapter";
import {
  importLedger,
  parseCsv,
  parseLedgerRows,
} from "../src/incident_commander/ledger-import";
import { toCsvRow } from "../src/incident_commander/csv";

async function sqliteMerchantStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-"));
  const connection = createSqliteDatabase(
    path.join(directory, "merchant.sqlite"),
  );
  migrate(connection.db, { migrationsFolder: "drizzle-sqlite" });
  return { connection, directory };
}

describe("parseLedgerRows", () => {
  it("parses quoted CSV fields containing commas and quotes", async () => {
    const csv = [
      "order_id,payment_id,state,amount_minor,currency",
      '"order_ABC123,with-comma",pay_123,pending,29900,INR',
      '"order_DEF""456",,paid,125000,INR',
    ].join("\n");
    const { rows, rejected } = await parseLedgerRows(
      Buffer.from(csv),
      "ledger.csv",
    );
    expect(rejected).toEqual([]);
    expect(rows).toEqual([
      {
        order_id: "order_ABC123,with-comma",
        payment_id: "pay_123",
        state: "pending",
        amount_minor: 29900,
        currency: "INR",
        updated_at: undefined,
      },
      {
        order_id: 'order_DEF"456',
        payment_id: undefined,
        state: "paid",
        amount_minor: 125000,
        currency: "INR",
        updated_at: undefined,
      },
    ]);
  });

  it("rejects rows with an unknown state or non-positive amount", async () => {
    const csv = [
      "order_id,state,amount_minor,currency",
      "order_ABC123,unknown,29900,INR",
      "order_DEF456,paid,0,INR",
      "order_GHI789,paid,54900,USD",
    ].join("\n");
    const { rows, rejected } = await parseLedgerRows(
      Buffer.from(csv),
      "ledger.csv",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ order_id: "order_GHI789" });
    expect(rejected.map((item) => item.row)).toEqual([2, 3]);
    expect(rejected[0]?.reason).toContain("state");
    expect(rejected[1]?.reason).toContain("amount_minor");
  });

  it("rejects an unsupported file type", async () => {
    await expect(
      parseLedgerRows(Buffer.from("x"), "ledger.json"),
    ).rejects.toThrow(/\.csv or \.xlsx/);
  });

  it("parses an XLSX workbook written in memory", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("orders");
    sheet.addRow([
      "order_id",
      "payment_id",
      "state",
      "amount_minor",
      "currency",
      "updated_at",
    ]);
    sheet.addRow(["order_XLS123", "pay_XLS123", "pending", 29900, "INR"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { rows, rejected } = await parseLedgerRows(buffer, "ledger.xlsx");
    expect(rejected).toEqual([]);
    expect(rows).toEqual([
      {
        order_id: "order_XLS123",
        payment_id: "pay_XLS123",
        state: "pending",
        amount_minor: 29900,
        currency: "INR",
        updated_at: undefined,
      },
    ]);
  });
});

describe("parseCsv", () => {
  it("keeps line breaks inside quoted fields", () => {
    expect(parseCsv('a,"b\nc",d\ne,f,g')).toEqual([
      ["a", "b\nc", "d"],
      ["e", "f", "g"],
    ]);
  });
});

describe("importLedger", () => {
  it("imports rows and re-imports idempotently against the merchant store", async () => {
    const { connection, directory } = await sqliteMerchantStore();
    try {
      const rows = (
        await parseLedgerRows(
          await fs.readFile("fixtures/ledger-sample.csv"),
          "ledger-sample.csv",
        )
      ).rows;
      const first = await importLedger(
        { kind: "sqlite", db: connection.db },
        rows,
      );
      expect(first).toEqual({ accepted: 3, updated: 0, rejected: [] });
      const adapter = new SqliteMerchantPlatformAdapter(connection.db);
      await expect(
        adapter.fetchOrderState("order_DEMOA1Ck5LnqFT"),
      ).resolves.toMatchObject({
        state: "pending",
        amount_minor: 29900,
        payment_id: "pay_DEMOq1XkfnEq0m",
      });

      const second = await importLedger(
        { kind: "sqlite", db: connection.db },
        rows,
      );
      expect(second).toEqual({ accepted: 0, updated: 3, rejected: [] });
      const stored = connection.db.select().from(merchantOrders).all();
      expect(stored).toHaveLength(3);

      // A changed row updates the existing order in place.
      const sample = rows[0];
      if (!sample) throw new Error("sample ledger row is missing");
      const changed = [{ ...sample, state: "paid" as const }];
      const third = await importLedger(
        { kind: "sqlite", db: connection.db },
        changed,
      );
      expect(third).toEqual({ accepted: 0, updated: 1, rejected: [] });
      await expect(
        adapter.fetchOrderState("order_DEMOA1Ck5LnqFT"),
      ).resolves.toMatchObject({ state: "paid" });
    } finally {
      connection.client.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("toCsvRow", () => {
  it("escapes commas, quotes, and line breaks", () => {
    expect(toCsvRow(["a,b", 'c"d', "e\nf", null, 5])).toBe(
      '"a,b","c""d","e\nf",,5\r\n',
    );
  });
});
