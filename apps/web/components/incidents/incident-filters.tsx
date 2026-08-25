"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function IncidentFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search incident, payment, or order ID"
          className="pl-9"
          defaultValue={params.get("q") ?? ""}
          onChange={(event) => update("q", event.target.value)}
          placeholder="Search incident, payment, or order ID"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Select
          value={params.get("status") ?? "all"}
          onValueChange={(value) => update("status", value ?? "all")}
        >
          <SelectTrigger
            aria-label="Filter by status"
            className="w-full sm:w-32"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="reconciled">Verified</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={params.get("class") ?? "all"}
          onValueChange={(value) => update("class", value ?? "all")}
        >
          <SelectTrigger
            aria-label="Filter by incident class"
            className="w-full sm:w-44"
          >
            <SelectValue placeholder="Incident class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            <SelectItem value="paid_pending">Paid, order pending</SelectItem>
            <SelectItem value="paid_missing">Paid, order missing</SelectItem>
            <SelectItem value="one_payment_two_orders">
              One payment, two orders
            </SelectItem>
            <SelectItem value="capture_timeout">Capture timeout</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="hidden sm:inline-flex"
          onClick={() => router.push(pathname)}
          data-icon="inline-start"
        >
          <SlidersHorizontal aria-hidden="true" />
          Clear filters
        </Button>
      </div>
    </div>
  );
}
