import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getBatchDto, requestContext } from "@/lib/incidents";
import { toBatchIncidentRow } from "@/lib/incident-projection";
import { formatDate } from "@/components/shared/format";
import { BatchView } from "@/components/batches/batch-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { tenantId } = requestContext(await headers());
  // Called here — before the streaming shell flushes — so an unknown batch
  // answers with a real 404 instead of a 200 that streams the not-found UI.
  if (!(await getBatchDto(tenantId, id))) notFound();
  return { title: `Batch ${id}` };
}

export const dynamic = "force-dynamic";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);
  const batch = await getBatchDto(tenantId, id);
  if (!batch) notFound();
  return (
    <BatchView
      batchId={batch.batch_id}
      incidents={batch.incidents.map(toBatchIncidentRow)}
      // The recorded roster is the count of record: incidents that have
      // since vanished from the store still count, exactly as the list
      // counts them, so both pages answer the same number.
      total={batch.incident_ids.length}
      // Formatted here on the server — the shared formatter pins one zone,
      // so the streamed HTML and any hydration pass agree on the clock.
      startedLabel={formatDate(batch.started_at)}
    />
  );
}
