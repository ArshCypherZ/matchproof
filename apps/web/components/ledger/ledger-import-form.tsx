"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type ImportResult = {
  accepted: number;
  updated: number;
  rejected: { row: number; reason: string }[];
};

type ImportState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done"; result: ImportResult }
  | { kind: "failed"; reason: string };

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".csv", ".xlsx"];
const MAX_REJECTED_SHOWN = 20;
// Bounded so a hung upload can never strand the form in "Importing…".
const UPLOAD_TIMEOUT_MS = 120_000;

// An error we already translated into operator copy. Browser-thrown errors
// (network, timeout) never pass through here, so their messages stay internal.
class OperatorError extends Error {}

function isImportResult(value: unknown): value is ImportResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ImportResult>;
  return (
    typeof candidate.accepted === "number" &&
    Number.isFinite(candidate.accepted) &&
    typeof candidate.updated === "number" &&
    Number.isFinite(candidate.updated) &&
    Array.isArray(candidate.rejected) &&
    candidate.rejected.every(
      (rejection) =>
        typeof rejection?.row === "number" &&
        typeof rejection?.reason === "string",
    )
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

// Map the import route's error codes to copy an operator can act on.
function importError(payload: {
  error?: string;
  max_rows?: number;
  reason?: string;
  retry_after_seconds?: number;
}) {
  switch (payload.error) {
    case "file_too_large":
      return "That file is larger than 5 MB. Split it into smaller files and import each one.";
    case "too_many_rows":
      return `That file has more than ${formatCount(payload.max_rows ?? 5000)} rows. Split it into smaller files and import each one.`;
    case "invalid_ledger":
      return payload.reason
        ? `${payload.reason} Fix the file and import it again.`
        : "The file could not be read as a ledger. Check that it is a .csv or .xlsx with the expected columns.";
    case "invalid_form_data":
    case "missing_file":
    case "expected_multipart_upload":
      return "The upload could not be read. Choose the file again and retry.";
    case "rate_limited":
      return `Too many imports in a short time. No orders were changed. Try again in ${payload.retry_after_seconds ?? 60} seconds.`;
    default:
      return "The import did not complete. No orders were changed. Try again.";
  }
}

export function LedgerImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const [filename, setFilename] = useState("");
  const [fileSizeBytes, setFileSizeBytes] = useState(0);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    // The submit stays enabled so the first step is never a greyed button:
    // an empty submit teaches, with the same inline error band as any other
    // rejection.
    if (!file) {
      setState({ kind: "failed", reason: "Choose a ledger file to import." });
      inputRef.current?.focus();
      return;
    }
    const dot = file.name.lastIndexOf(".");
    const extension = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setState({
        kind: "failed",
        reason: `Imports accept .csv and .xlsx files only. This file is ${
          extension ? `a ${extension} file` : "missing an extension"
        }.`,
      });
      inputRef.current?.focus();
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({
        kind: "failed",
        reason: `That file is ${formatBytes(file.size)}. Imports are limited to 5 MB. Split it into smaller files and import each one.`,
      });
      inputRef.current?.focus();
      return;
    }
    setState({ kind: "uploading" });
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/ledger/import", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
          max_rows?: number;
          reason?: string;
          retry_after_seconds?: number;
        };
        throw new OperatorError(importError(error));
      }
      const result: unknown = await response.json().catch(() => null);
      if (!isImportResult(result))
        throw new OperatorError(
          "The import finished, but its result could not be read. Importing the same file again is safe: existing orders are updated, not duplicated.",
        );
      setState({ kind: "done", result });
      setFilename("");
      setFileSizeBytes(0);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      if (error instanceof OperatorError) {
        setState({ kind: "failed", reason: error.message });
      } else if (
        error instanceof DOMException &&
        error.name === "TimeoutError"
      ) {
        setState({
          kind: "failed",
          reason:
            "The import did not finish within two minutes and was stopped. No orders were changed. Try again, or split the file into smaller imports.",
        });
      } else {
        // fetch rejects with a TypeError when the request never reaches the
        // server; its raw message is never operator copy.
        setState({
          kind: "failed",
          reason:
            "The import could not reach the server. No orders were changed. Check the connection and try again.",
        });
      }
      // Every rejection, client- or server-side, returns focus to the one
      // control whose change can resolve it.
      inputRef.current?.focus();
    }
  };
  return (
    <>
      <form
        onSubmit={submit}
        className={`flex flex-col gap-3 p-5 sm:flex-row sm:items-center ${
          state.kind === "done" ? "border-b border-border" : ""
        }`}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="ledger-file" className="text-sm font-medium">
            Ledger file
          </label>
          <input
            id="ledger-file"
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            aria-invalid={state.kind === "failed" || undefined}
            aria-describedby={`ledger-file-hint${
              state.kind === "failed" ? " ledger-import-error" : ""
            }`}
            // Swapping the file mid-upload would let the finished result of
            // the old file land as if it were about this one, so the input
            // holds still until the request settles.
            disabled={state.kind === "uploading"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              setFilename(file?.name ?? "");
              setFileSizeBytes(file?.size ?? 0);
              setState({ kind: "idle" });
            }}
            className="focus-ring mt-2 block w-full text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:touch-manipulation file:rounded-lg file:border file:border-input file:bg-surface file:px-3 file:py-2 file:text-sm file:text-foreground file:transition-colors file:duration-(--motion-duration-fast) file:ease-[var(--motion-ease-out)] file:hover:bg-surface-subtle disabled:file:cursor-not-allowed disabled:file:opacity-60 pointer-coarse:file:py-3.5 pointer-coarse:file:text-base"
          />
          <p
            id="ledger-file-hint"
            className="mt-2 text-xs text-muted-foreground"
          >
            CSV or XLSX, up to 5&nbsp;MB and 5,000&nbsp;rows.
          </p>
          {filename ? (
            <p className="mt-2 truncate font-data text-xs text-muted-foreground">
              {filename}
              {fileSizeBytes ? ` · ${formatBytes(fileSizeBytes)}` : ""}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          disabled={state.kind === "uploading"}
          aria-busy={state.kind === "uploading" || undefined}
          data-icon="inline-start"
          className="max-sm:w-full"
        >
          {state.kind === "uploading" ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {state.kind === "uploading" ? "Importing…" : "Import ledger"}
        </Button>
      </form>
      {state.kind === "failed" ? (
        /* A failed import is a hard failure, not an ambiguous state: it
           carries the destructive pairing (tint plus strong ink) the Badge
           danger variant owns, so warning stays reserved for caution bands.
           Strong ink, never gray, on the tinted fill. */
        <div
          role="alert"
          id="ledger-import-error"
          className="flex gap-3 bg-destructive/10 px-5 py-3"
        >
          <XCircle
            aria-hidden="true"
            className="mt-0.5 size-4 text-destructive"
          />
          <p className="text-sm text-destructive-strong">{state.reason}</p>
        </div>
      ) : null}
      {state.kind === "done" ? (
        <div role="status" className="p-5">
          <div className="flex gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 text-primary"
            />
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-data">
                  {formatCount(state.result.accepted)}
                </span>{" "}
                {state.result.accepted === 1 ? "order" : "orders"} imported ·{" "}
                <span className="font-data">
                  {formatCount(state.result.updated)}
                </span>{" "}
                {state.result.updated === 1 ? "order" : "orders"} updated
              </p>
              {/* The counts end the transaction; the queue is where the
                  imported orders take effect, so the momentum continues
                  there. -ml-2.5 returns the link's leading padding so it
                  aligns with the counts above it. */}
              <Button
                render={<Link href="/incidents" />}
                variant="link"
                data-icon="inline-end"
                className="-ml-2.5 mt-2"
              >
                View exceptions <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
          {state.result.rejected.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">
                <span className="font-data">
                  {formatCount(state.result.rejected.length)}
                </span>{" "}
                {state.result.rejected.length === 1 ? "row was" : "rows were"}{" "}
                skipped and not imported. Fix{" "}
                {state.result.rejected.length === 1 ? "it" : "them"} in the file
                and import again
                {state.result.rejected.length > MAX_REJECTED_SHOWN
                  ? `. First ${MAX_REJECTED_SHOWN} shown.`
                  : "."}
              </p>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Rows the import skipped, with the reason for each
                  </caption>
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Row in file
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.rejected
                      .slice(0, MAX_REJECTED_SHOWN)
                      .map((rejection, index) => (
                        <tr
                          key={`${rejection.row}-${index}`}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className="py-2 pr-4 font-data text-sm whitespace-nowrap">
                            {rejection.row}
                          </td>
                          <td className="py-2 break-words">
                            {rejection.reason}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
