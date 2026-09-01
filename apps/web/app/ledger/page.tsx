import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { count, max } from "drizzle-orm";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/components/shared/format";
import { merchantOrders } from "../../../../src/db/schema";
import { sharedDatabase } from "../../../../src/db/client";
import { LedgerImportForm } from "@/components/ledger/ledger-import-form";

export const metadata: Metadata = { title: "Ledger import" };

export const dynamic = "force-dynamic";

// Literal values an operator must type into the file: they read as data,
// not prose, so they keep the data face while inheriting the note's tone.
// translate="no" keeps auto-translate from garbling the identifiers.
function DataValue({ children }: { children: ReactNode }) {
  return (
    <span className="font-data" translate="no">
      {children}
    </span>
  );
}

const columns: { name: string; note: ReactNode }[] = [
  {
    name: "order_id",
    note: (
      <>
        Provider order reference, for example <DataValue>order_NyXX…</DataValue>
      </>
    ),
  },
  {
    name: "payment_id",
    note: <>Optional provider payment reference</>,
  },
  {
    name: "state",
    note: (
      <>
        Order state Matchproof checks the payment against,{" "}
        <DataValue>pending</DataValue> or <DataValue>paid</DataValue>
      </>
    ),
  },
  {
    name: "amount_minor",
    note: (
      <>
        Integer amount in the smallest currency unit, for example{" "}
        <DataValue>29900</DataValue> for ₹299.00
      </>
    ),
  },
  {
    name: "currency",
    note: (
      <>
        Three-letter ISO code, for example <DataValue>INR</DataValue>
      </>
    ),
  },
  {
    name: "updated_at",
    note: (
      <>
        Optional ISO timestamp, for example{" "}
        <DataValue>2026-08-28T10:12:00Z</DataValue>
      </>
    ),
  },
];

export default async function LedgerPage() {
  // The import writes merchant_orders directly, so the same table answers
  // "what does Matchproof currently believe?" — one count, plus the newest
  // record stamp as the ledger's freshness, in the count-beside-h1 slot the
  // queue and batches screens already own.
  const [snapshot] = await sharedDatabase()
    .db.select({
      orderCount: count(),
      newestUpdate: max(merchantOrders.updatedAt),
    })
    .from(merchantOrders);
  const orderWord = snapshot.orderCount === 1 ? "order" : "orders";
  return (
    <main id="main-content" tabIndex={-1} className="page-rail py-10 sm:py-14">
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <h1 className="font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Ledger import
            </h1>
            <div className="flex items-baseline gap-2 pb-0.5">
              <span className="font-display text-xl font-medium leading-none tabular-nums">
                {snapshot.orderCount}
              </span>
              <span className="text-xs text-muted-foreground">
                {orderWord}
                {snapshot.newestUpdate
                  ? ` · updated through ${formatDate(
                      snapshot.newestUpdate.toISOString(),
                    )}`
                  : ""}
              </span>
            </div>
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Add or update the merchant orders Matchproof checks Razorpay
            payments against, from a CSV or XLSX export.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            render={<Link href="/ledger-sample.csv" download />}
            variant="outline"
            data-icon="inline-start"
            className="max-sm:w-full max-sm:flex-1"
          >
            <Download aria-hidden="true" />
            Download sample CSV
          </Button>
        </div>
      </div>
      {/* One task column: the import act and its format spec share a
          measure, capped like the shell's other task content (demo,
          batch notes) instead of stretching the operations rail. */}
      <div className="mt-10 max-w-2xl">
        <Card>
          <LedgerImportForm />
        </Card>
        <section aria-labelledby="columns-heading" className="mt-10">
          <h2
            id="columns-heading"
            className="text-balance text-lg font-semibold"
          >
            Expected columns
          </h2>
          <dl className="mt-5 grid border-t border-border sm:grid-cols-2">
            {columns.map((column) => (
              <div
                key={column.name}
                className="border-b border-border py-5 sm:odd:pr-8 sm:even:border-l sm:even:pl-8"
              >
                <dt className="font-data text-sm" translate="no">
                  {column.name}
                </dt>
                <dd className="mt-2 text-sm leading-6 text-muted-foreground">
                  {column.note}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
