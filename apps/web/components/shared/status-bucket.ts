// One bucketing of exception statuses for every batch surface. The list
// rows and the detail tallies both reduce statuses through this helper, so
// the two pages cannot disagree about the same batch. A status the batch
// vocabulary does not know — including a missing record — reads as
// pending: the queue's awaiting-attention state, never a silent drop.
export type StatusBucket = "pending" | "ambiguous" | "escalated" | "reconciled";

export function statusBucket(status: string | undefined | null): StatusBucket {
  if (
    status === "reconciled" ||
    status === "escalated" ||
    status === "ambiguous"
  ) {
    return status;
  }
  return "pending";
}
