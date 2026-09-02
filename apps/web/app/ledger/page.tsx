import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { count, max } from "drizzle-orm";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/components/shared/format";
import { CountChip } from "@/components/shared/count-chip";
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
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <h1 className="font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Ledger import
            </h1>
            {/* The count rides the title baseline as one boxed unit on a
                tonal surface — a stray number floating beside the h1 reads
                as decoration, a boxed figure reads as a datum. */}
            <CountChip value={snapshot.orderCount}>
              {orderWord}
              {snapshot.newestUpdate
                ? ` · updated through ${formatDate(
                    snapshot.newestUpdate.toISOString(),
                  )}`
                : ""}
            </CountChip>
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
      {/* The import act keeps the shell's task measure (demo, batch notes) —
          a file form stretched across the workspace rail is unusable. The
          format spec below is reference material, so it spans the rail like
          the grids on metrics, giving its six columns room to sit three
          across. */}
      <div className="mt-10 max-w-2xl">
        <Card>
          <LedgerImportForm />
        </Card>
      </div>
      <section aria-labelledby="columns-heading" className="mt-10">
        <h2 id="columns-heading" className="text-balance text-lg font-semibold">
          Expected columns
        </h2>
        {/* Six definitions as a 3×2 field of boxed cells: each cell is the
            console's card treatment (tonal surface, rounded-xl) so the grid
            separates by surface and gap, never by hairline dividers. One
            column on narrow screens, two at sm, the full three-by-two at lg.
            The h2-to-grid interval is mt-7: the same chapter-head spacing
            metrics' h2 sections own (mb-7), so both h2 pages breathe alike. */}
        <dl className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {columns.map((column) => (
            <div
              key={column.name}
              className="rounded-xl bg-surface px-4 py-4 sm:px-5"
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
    </main>
  );
}
