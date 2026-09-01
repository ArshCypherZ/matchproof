import { createHash } from "node:crypto";
import {
  incidentListFingerprint,
  listBatchDtos,
  requestContext,
} from "../../../../lib/incidents";

export const dynamic = "force-dynamic";

// The Batches page renders two inputs: the batch-started audit records and
// the incident rows that give each band its proportions. Incident status
// derives from progress rows the incident digest already hashes, so this
// fingerprint reuses that digest instead of re-deriving every incident DTO
// on each tick; the batch list itself is cheap to read (audit records only).
export async function GET(request: Request) {
  const { tenantId } = requestContext(request);
  const [batches, incidentsDigest] = await Promise.all([
    listBatchDtos(tenantId),
    incidentListFingerprint(tenantId),
  ]);
  const rows = [
    ...batches.map((batch) => JSON.stringify(batch)),
    incidentsDigest,
  ].sort();
  const digest = createHash("sha256");
  for (const row of rows) digest.update(row, "utf8");
  return Response.json({ fingerprint: digest.digest("hex") });
}
