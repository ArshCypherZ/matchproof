import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { merchantOrders as pgMerchantOrders } from "../db/schema";
import { merchantOrders as sqliteMerchantOrders } from "../db/sqlite-schema";
import type { Database } from "../db/client";
import type { SqliteDatabase } from "../db/sqlite-client";

const optionalCell = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    schema,
  );

// Every message is written for the operator who reads it in the import
// result table, so each one names its column and states the expected value
// instead of quoting the validator's internals.
export const LedgerRowSchema = z.object({
  order_id: z
    .string()
    .trim()
    .min(3, "order_id must be 3 to 128 characters, for example order_NyXX...")
    .max(
      128,
      "order_id must be 3 to 128 characters, for example order_NyXX...",
    ),
  payment_id: optionalCell(
    z
      .string()
      .trim()
      .min(1, "payment_id must be 1 to 128 characters when provided")
      .max(128, "payment_id must be 1 to 128 characters when provided")
      .optional(),
  ),
  state: z.enum(["pending", "paid"], {
    message: "state must be 'pending' or 'paid'",
  }),
  // Capped at the Postgres integer column bound so one oversized row is
  // rejected per-row; a bad row does not abort the whole import.
  amount_minor: z.coerce
    .number({
      message:
        "amount_minor must be a positive whole number in the smallest currency unit, for example 29900 for 299.00",
    })
    .int(
      "amount_minor must be a positive whole number in the smallest currency unit, for example 29900 for 299.00",
    )
    .positive(
      "amount_minor must be a positive whole number in the smallest currency unit, for example 29900 for 299.00",
    )
    .max(2_147_483_647, "amount_minor is too large; the maximum is 2147483647"),
  currency: z
    .string()
    .trim()
    .length(3, "currency must be a 3-letter ISO code, for example INR"),
  updated_at: optionalCell(
    z
      .string()
      .datetime({
        message:
          "updated_at must be an ISO timestamp, for example 2026-08-28T10:12:00Z",
      })
      .optional(),
  ),
});

export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export type LedgerRejection = { row: number; reason: string };

export type LedgerImportResult = {
  accepted: number;
  updated: number;
  rejected: LedgerRejection[];
};

export class LedgerFormatError extends Error {}

/**
 * Minimal RFC 4180 CSV splitter: quoted fields may contain commas, doubled
 * quotes, and line breaks.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") pushField();
    else if (char === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      pushRow();
    } else field += char;
  }
  if (field || row.length) pushRow();
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

const LEDGER_COLUMNS = [
  "order_id",
  "payment_id",
  "state",
  "amount_minor",
  "currency",
  "updated_at",
] as const;

const REQUIRED_COLUMNS = ["order_id", "state", "amount_minor", "currency"];

type ParsedRecord =
  | { success: true; data: LedgerRow }
  | { success: false; error: z.ZodError<LedgerRow> };

function recordsFromMatrix(matrix: readonly string[][]): ParsedRecord[] {
  // Spreadsheet exports often carry trailing rows that exist only due to
  // formatting; they are not ledger rows.
  const rows = matrix.filter((entry) =>
    entry.some((cell) => cell.trim() !== ""),
  );
  const [header] = rows;
  if (!header)
    throw new LedgerFormatError(
      "The file has no header row. The first row must name the columns, like the sample CSV.",
    );
  const normalizedHeader = header.map((cell) => cell.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(
    (column) => !normalizedHeader.includes(column),
  );
  if (missing.length)
    throw new LedgerFormatError(
      `The header row is missing required columns: ${missing.join(", ")}.`,
    );
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    normalizedHeader.forEach((column, position) => {
      if ((LEDGER_COLUMNS as readonly string[]).includes(column))
        record[column] = (cells[position] ?? "").trim();
    });
    return LedgerRowSchema.safeParse(record);
  });
}

async function recordsFromWorkbook(bytes: Uint8Array): Promise<ParsedRecord[]> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new LedgerFormatError(
      "The XLSX file could not be opened. Check that it is a valid .xlsx workbook.",
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new LedgerFormatError("The XLSX file has no worksheet.");
  const matrix: string[][] = [];
  sheet.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    for (let column = 1; column <= LEDGER_COLUMNS.length; column += 1) {
      const value = row.getCell(column).value;
      if (value instanceof Date) cells.push(value.toISOString());
      else if (value && typeof value === "object")
        cells.push(String((value as { text?: string }).text ?? ""));
      else
        cells.push(value === null || value === undefined ? "" : String(value));
    }
    matrix[rowNumber - 1] = cells;
  });
  return recordsFromMatrix(matrix);
}

/** Parse a CSV or XLSX ledger export into validated rows plus per-row errors. */
export async function parseLedgerRows(
  bytes: Uint8Array,
  filename: string,
): Promise<{ rows: LedgerRow[]; rejected: LedgerRejection[] }> {
  const extension = filename.toLowerCase().split(".").pop();
  let parsed: ParsedRecord[];
  if (extension === "xlsx") parsed = await recordsFromWorkbook(bytes);
  else if (extension === "csv")
    parsed = recordsFromMatrix(parseCsv(new TextDecoder().decode(bytes)));
  else throw new LedgerFormatError("The file must be a .csv or .xlsx file.");
  const rows: LedgerRow[] = [];
  const rejected: LedgerRejection[] = [];
  parsed.forEach((result, index) => {
    if (result.success) rows.push(result.data);
    else
      rejected.push({
        row: index + 2,
        reason: result.error.issues
          .map((issue: { path: PropertyKey[]; message: string }) => {
            // Schema messages already name their column; prefix only a
            // message that does not, so no reason loses its column context.
            const column = issue.path.join(".");
            return column && !issue.message.startsWith(column)
              ? `${column}: ${issue.message}`
              : issue.message;
          })
          .join("; "),
      });
  });
  return { rows, rejected };
}

export type LedgerTarget =
  { kind: "postgres"; db: Database } | { kind: "sqlite"; db: SqliteDatabase };

/**
 * Upsert validated ledger rows into the merchant order table. Re-importing the
 * same ledger updates the matching orders, so the import is idempotent.
 */
export async function importLedger(
  target: LedgerTarget,
  rows: readonly LedgerRow[],
  now: () => Date = () => new Date(),
): Promise<LedgerImportResult> {
  if (!rows.length) return { accepted: 0, updated: 0, rejected: [] };
  // A later row for the same order wins, and one statement cannot touch the
  // same conflict target twice.
  const latest = new Map(rows.map((row) => [row.order_id, row]));
  const uniqueRows = [...latest.values()];
  const orderIds = [...latest.keys()];
  const existingIds = new Set(
    (target.kind === "postgres"
      ? await target.db
          .select({ orderId: pgMerchantOrders.orderId })
          .from(pgMerchantOrders)
          .where(inArray(pgMerchantOrders.orderId, orderIds))
      : await target.db
          .select({ orderId: sqliteMerchantOrders.orderId })
          .from(sqliteMerchantOrders)
          .where(inArray(sqliteMerchantOrders.orderId, orderIds))
    ).map((row) => row.orderId),
  );
  if (target.kind === "postgres") {
    const stamp = (row: LedgerRow) =>
      row.updated_at ? new Date(row.updated_at) : now();
    await target.db
      .insert(pgMerchantOrders)
      .values(
        uniqueRows.map((row) => ({
          orderId: row.order_id,
          paymentId: row.payment_id ?? null,
          state: row.state,
          amountMinor: row.amount_minor,
          currency: row.currency,
          createdAt: stamp(row),
          updatedAt: stamp(row),
        })),
      )
      .onConflictDoUpdate({
        target: pgMerchantOrders.orderId,
        set: {
          paymentId: sql`excluded.payment_id`,
          state: sql`excluded.state`,
          amountMinor: sql`excluded.amount_minor`,
          currency: sql`excluded.currency`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  } else {
    const stamp = (row: LedgerRow) => row.updated_at ?? now().toISOString();
    await target.db
      .insert(sqliteMerchantOrders)
      .values(
        uniqueRows.map((row) => ({
          orderId: row.order_id,
          paymentId: row.payment_id ?? null,
          state: row.state,
          amountMinor: row.amount_minor,
          currency: row.currency,
          createdAt: stamp(row),
          updatedAt: stamp(row),
        })),
      )
      .onConflictDoUpdate({
        target: sqliteMerchantOrders.orderId,
        set: {
          paymentId: sql`excluded.payment_id`,
          state: sql`excluded.state`,
          amountMinor: sql`excluded.amount_minor`,
          currency: sql`excluded.currency`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return {
    accepted: orderIds.length - existingIds.size,
    updated: existingIds.size,
    rejected: [],
  };
}
