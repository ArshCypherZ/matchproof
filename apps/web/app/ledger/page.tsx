import type { Metadata } from "next";
import Link from "next/link";
import { Database } from "lucide-react";
import { LedgerImportForm } from "@/components/ledger/ledger-import-form";

export const metadata: Metadata = { title: "Ledger import" };

const columns = [
  {
    name: "order_id",
    note: "Provider order reference, for example order_NyXX...",
  },
  { name: "payment_id", note: "Optional provider payment reference" },
  { name: "state", note: "pending or paid" },
  {
    name: "amount_minor",
    note: "Integer amount in the smallest currency unit",
  },
  { name: "currency", note: "Three-letter ISO code" },
  { name: "updated_at", note: "Optional ISO timestamp" },
];

export default function LedgerPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="border-b border-border pb-8">
        <p className="mb-3 font-data text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Merchant ledger
        </p>
        <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
          Ledger import
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Upload a CSV or XLSX file to add or update merchant orders used for
          reconciliation.
        </p>
      </div>
      <section aria-labelledby="import-heading" className="mt-10">
        <div className="mb-5 flex items-baseline gap-3">
          <span className="font-data text-2xs text-muted-foreground">01</span>
          <h2 id="import-heading" className="text-base font-semibold">
            Upload ledger
          </h2>
        </div>
        <LedgerImportForm />
      </section>
      <section aria-labelledby="columns-heading" className="mt-10">
        <div className="mb-5 flex items-baseline gap-3">
          <span className="font-data text-2xs text-muted-foreground">02</span>
          <h2 id="columns-heading" className="text-base font-semibold">
            Expected columns
          </h2>
        </div>
        <dl className="grid border-t border-border sm:grid-cols-2">
          {columns.map((column) => (
            <div
              key={column.name}
              className="border-b border-border py-5 sm:odd:pr-8 sm:even:border-l sm:even:pl-8"
            >
              <dt className="font-data text-xs">{column.name}</dt>
              <dd className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                {column.note}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Database aria-hidden="true" className="size-4" />
          <Link
            href="/ledger-sample.csv"
            download
            className="focus-ring rounded-sm underline underline-offset-4"
          >
            Download a sample ledger CSV
          </Link>
        </p>
      </section>
    </main>
  );
}
