import { requestContext, withStore } from "../../../../lib/incidents";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import {
  importLedger,
  parseLedgerRows,
  LedgerFormatError,
} from "../../../../../../src/incident_commander/ledger-import";
import { sharedDatabase } from "../../../../../../src/db/client";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_LEDGER_ROWS = 5000;

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "ledger-import", {
    limit: 5,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const { tenantId, actor } = requestContext(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data"))
    return Response.json(
      { error: "expected_multipart_upload" },
      { status: 400 },
    );
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form_data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File))
    return Response.json({ error: "missing_file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return Response.json({ error: "file_too_large" }, { status: 413 });
  let parsed: Awaited<ReturnType<typeof parseLedgerRows>>;
  try {
    parsed = await parseLedgerRows(
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );
  } catch (error) {
    if (error instanceof LedgerFormatError)
      return Response.json(
        { error: "invalid_ledger", reason: error.message },
        { status: 400 },
      );
    throw error;
  }
  if (parsed.rows.length > MAX_LEDGER_ROWS)
    return Response.json(
      { error: "too_many_rows", max_rows: MAX_LEDGER_ROWS },
      { status: 400 },
    );
  const connection = sharedDatabase();
  const result = await importLedger(
    { kind: "postgres", db: connection.db },
    parsed.rows,
  );
  const outcome = {
    accepted: result.accepted,
    updated: result.updated,
    rejected: [...parsed.rejected, ...result.rejected],
  };
  await withStore(tenantId, (store) =>
    store.audit("ledger_imported", {
      tenant_id: tenantId,
      actor,
      action: "import_ledger",
      approval_state: "not_required",
      details: {
        filename: file.name,
        accepted: outcome.accepted,
        updated: outcome.updated,
        rejected: outcome.rejected.length,
      },
    }),
  );
  return Response.json(outcome);
}
