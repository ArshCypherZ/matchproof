"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StartBatchButton } from "@/components/batches/start-batch-button";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatAge, formatMoney } from "@/components/shared/format";

type IncidentItem = {
  incident_id: string;
  incident_class: string;
  status: string;
  payment_id: string;
  order_id: string | null;
  payment: { amount_minor: number; currency: string } | null;
  age_seconds: number;
  current_step: string;
  current_step_status: string;
  source_kind: string;
  updated_at: string;
};

function classLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function IncidentQueue({ items }: { items: IncidentItem[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (incidentId: string) =>
    setSelected((current) =>
      current.includes(incidentId)
        ? current.filter((item) => item !== incidentId)
        : [...current, incidentId],
    );
  const allSelected = items.length > 0 && selected.length === items.length;
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="text-xs text-muted-foreground">
          {selected.length} selected for batch processing
        </span>
        <StartBatchButton incidentIds={selected} />
      </div>
      <IncidentTable
        items={items}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() =>
          setSelected(allSelected ? [] : items.map((item) => item.incident_id))
        }
      />
      <IncidentMobileList items={items} selected={selected} onToggle={toggle} />
    </>
  );
}

function IncidentTable({
  items,
  selected,
  onToggle,
  onToggleAll,
}: {
  items: IncidentItem[];
  selected: string[];
  onToggle: (incidentId: string) => void;
  onToggleAll: () => void;
}) {
  if (!items.length)
    return (
      <div className="px-5 py-16 text-center text-sm text-muted-foreground">
        No payment exceptions match these filters.
      </div>
    );
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full caption-bottom text-sm">
        <caption className="sr-only">Payment and order exception queue</caption>
        <thead className="border-b border-border bg-surface-subtle text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-12 px-5 py-3 font-medium">
              <input
                type="checkbox"
                aria-label="Select all incidents on this page"
                checked={items.length > 0 && selected.length === items.length}
                onChange={onToggleAll}
                className="size-4 accent-primary"
              />
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Incident
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Payment
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Age
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Current step
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Source
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.incident_id}
              className="border-b border-border transition-colors last:border-0 hover:bg-surface-subtle"
            >
              <td className="px-5 py-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${item.incident_id}`}
                  checked={selected.includes(item.incident_id)}
                  onChange={() => onToggle(item.incident_id)}
                  className="size-4 accent-primary"
                />
              </td>
              <td className="px-5 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="max-w-64 px-3 py-3">
                <Link
                  href={`/incidents/${item.incident_id}`}
                  className="focus-ring block rounded-md"
                >
                  <span className="block truncate font-medium">
                    {classLabel(item.incident_class)}
                  </span>
                  <span className="mt-1 block truncate font-data text-xs text-muted-foreground">
                    {item.incident_id}
                  </span>
                </Link>
              </td>
              <td className="max-w-56 px-3 py-3">
                <span className="block truncate font-data text-xs">
                  {item.payment_id}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {item.order_id ?? "Order not uniquely mapped"}
                </span>
              </td>
              <td className="px-3 py-3 text-right font-data text-xs">
                {formatMoney(
                  item.payment?.amount_minor,
                  item.payment?.currency,
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-3 font-data text-xs text-muted-foreground">
                {formatAge(item.age_seconds)}
              </td>
              <td className="px-3 py-3">
                <span className="font-medium capitalize">
                  {item.current_step}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.current_step_status}
                </span>
              </td>
              <td className="px-3 py-3">
                <SourceBadge source={item.source_kind} />
              </td>
              <td className="px-5 py-3 text-right">
                <Button
                  render={<Link href={`/incidents/${item.incident_id}`} />}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open ${item.incident_id}`}
                >
                  <ArrowUpRight aria-hidden="true" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncidentMobileList({
  items,
  selected,
  onToggle,
}: {
  items: IncidentItem[];
  selected: string[];
  onToggle: (incidentId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="divide-y divide-border md:hidden">
      {items.map((item) => (
        <article
          key={item.incident_id}
          className="px-4 py-4 hover:bg-surface-subtle"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                aria-label={`Select ${item.incident_id}`}
                checked={selected.includes(item.incident_id)}
                onChange={() => onToggle(item.incident_id)}
                className="size-4 accent-primary"
              />
              <StatusBadge status={item.status} />
            </div>
            <span className="font-data text-xs text-muted-foreground">
              {formatAge(item.age_seconds)}
            </span>
          </div>
          <Link
            href={`/incidents/${item.incident_id}`}
            className="focus-ring mt-3 block rounded"
          >
            <p className="font-medium capitalize">
              {classLabel(item.incident_class)}
            </p>
          </Link>
          <p className="mt-1 font-data text-xs text-muted-foreground">
            {item.incident_id}
          </p>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 text-xs">
            <span className="truncate font-data">{item.payment_id}</span>
            <span className="font-data">
              {formatMoney(item.payment?.amount_minor, item.payment?.currency)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Step:{" "}
              <span className="font-medium capitalize text-foreground">
                {item.current_step}
              </span>
            </span>
            <span className="flex items-center gap-1">
              Open <ChevronRight aria-hidden="true" className="size-3.5" />
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
