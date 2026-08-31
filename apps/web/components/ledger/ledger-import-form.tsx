"use client";

import { useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, Upload, XCircle } from "lucide-react";
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

// Map the import route's error codes to copy an operator can act on.
function importError(payload: { error?: string; max_rows?: number }) {
  switch (payload.error) {
    case "file_too_large":
      return "That file is larger than 5 MB. Split it into smaller imports.";
    case "too_many_rows":
      return `That file has more than ${payload.max_rows ?? 5000} rows. Split it into smaller imports.`;
    case "invalid_ledger":
    case "invalid_form_data":
    case "missing_file":
      return "The file could not be read as a ledger. Check that it is a .csv or .xlsx with the expected columns.";
    case "expected_multipart_upload":
      return "The upload was malformed. Choose the file again and retry.";
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
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setState({
        kind: "failed",
        reason: `Only .csv and .xlsx files can be imported. This file is ${extension || "missing an extension"}.`,
      });
      inputRef.current?.focus();
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({
        kind: "failed",
        reason: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Imports are limited to 5 MB. Split it into smaller files.`,
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
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
          max_rows?: number;
        };
        throw new Error(importError(error));
      }
      setState({
        kind: "done",
        result: (await response.json()) as ImportResult,
      });
      setFilename("");
      setFileSizeBytes(0);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setState({
        kind: "failed",
        reason:
          error instanceof Error
            ? error.message
            : `The import did not complete. No orders were changed. Try again.`,
      });
    }
  };
  return (
    <div className="border border-border">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="ledger-file" className="text-sm font-medium">
            Ledger file (.csv or .xlsx)
          </label>
          <input
            id="ledger-file"
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            aria-invalid={state.kind === "failed" || undefined}
            aria-describedby={
              state.kind === "failed" ? "ledger-import-error" : undefined
            }
            onChange={(event) => {
              const file = event.target.files?.[0];
              setFilename(file?.name ?? "");
              setFileSizeBytes(file?.size ?? 0);
              setState({ kind: "idle" });
            }}
            className="mt-2 block w-full text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:text-foreground pointer-coarse:file:py-3.5 pointer-coarse:file:text-base"
          />
          {filename ? (
            <p className="mt-2 truncate font-data text-xs text-muted-foreground">
              {filename}
              {fileSizeBytes
                ? ` · ${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                : ""}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          disabled={state.kind === "uploading" || !filename}
          data-icon="inline-start"
        >
          {state.kind === "uploading" ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          Import ledger
        </Button>
      </form>
      {state.kind === "failed" ? (
        <div
          role="alert"
          id="ledger-import-error"
          className="flex gap-3 border-b border-border border-l-2 border-l-warning bg-warning-soft px-5 py-3"
        >
          <XCircle aria-hidden="true" className="mt-0.5 size-4 text-warning" />
          <p className="text-sm text-muted-foreground">{state.reason}</p>
        </div>
      ) : null}
      {state.kind === "done" ? (
        <div role="status" className="p-5">
          <div className="flex gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 text-primary"
            />
            <p className="text-sm">
              <span className="font-data">
                {state.result.accepted} imported
              </span>{" "}
              ·{" "}
              <span className="font-data">{state.result.updated} updated</span>
            </p>
          </div>
          {state.result.rejected.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">
                <span className="font-data">
                  {state.result.rejected.length}
                </span>{" "}
                {state.result.rejected.length === 1
                  ? "row was rejected"
                  : "rows were rejected"}
                {state.result.rejected.length > MAX_REJECTED_SHOWN
                  ? ` (first ${MAX_REJECTED_SHOWN} shown)`
                  : ""}
                .
              </p>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Rows the import rejected, with the reason for each
                  </caption>
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Row
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.rejected
                      .slice(0, MAX_REJECTED_SHOWN)
                      .map((rejection) => (
                        <tr
                          key={rejection.row}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className="py-2 pr-4 font-data text-xs">
                            {rejection.row}
                          </td>
                          <td className="py-2 text-muted-foreground">
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
    </div>
  );
}
