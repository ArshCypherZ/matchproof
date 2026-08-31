import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getBatchDto, requestContext } from "@/lib/incidents";
import { toBatchIncidentRow } from "@/lib/incident-projection";
import { BatchView } from "@/components/batches/batch-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return { title: `Batch ${(await params).id}` };
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
      startedAt={batch.started_at}
    />
  );
}
