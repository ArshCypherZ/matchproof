import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBatchDto } from "@/lib/incidents";
import { BatchView } from "@/components/batches/batch-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return { title: `Batch ${(await params).id}` };
}

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batch = await getBatchDto("default-merchant", id);
  if (!batch) notFound();
  return (
    <BatchView
      batchId={batch.batch_id}
      incidents={batch.incidents}
      startedAt={batch.started_at}
    />
  );
}
