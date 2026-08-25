import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="space-y-3">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <Skeleton className="h-16 rounded-none border-b border-border" />
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton
            key={index}
            className="h-14 rounded-none border-b border-border last:border-0"
          />
        ))}
      </div>
    </main>
  );
}
