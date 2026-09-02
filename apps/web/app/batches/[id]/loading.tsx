import { Skeleton } from "@/components/ui/skeleton";
import { tallyCell } from "@/components/batches/tally-cell";

export default function Loading() {
  // The shell mirrors the real header, tally strip, and roster geometry —
  // same grid steps (two columns, three at sm, five at lg), same divider
  // rules, same row height — so the streamed page lands without a jump at
  // any width.
  return (
    <main
      id="main-content"
      tabIndex={-1}
      aria-busy="true"
      className="workspace-rail py-10 sm:py-14"
    >
      <span role="status" className="sr-only">
        Loading the page…
      </span>
      <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {/* "Batch" plus an eight-character id, the real heading's width. */}
          <Skeleton className="h-9 w-56 motion-reduce:animate-none" />
          <Skeleton className="mt-1 h-5 w-full max-w-md motion-reduce:animate-none" />
          <Skeleton className="mt-2 h-4 w-28 motion-reduce:animate-none" />
        </div>
        {/* The pause control the live header carries (icon-xs sizing). */}
        <div className="flex shrink-0 justify-start sm:justify-end">
          <Skeleton className="size-6 rounded-md motion-reduce:animate-none" />
        </div>
      </div>
      <div className="mt-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className={tallyCell}>
              <Skeleton className="h-7 w-10 motion-reduce:animate-none" />
              <Skeleton className="mt-2 h-3.5 w-20 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
        {/* The completion row: track plus index. */}
        <div className="mt-4 flex items-center gap-3">
          <Skeleton className="h-1.5 flex-1 rounded-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-24 shrink-0 motion-reduce:animate-none" />
        </div>
      </div>
      <div className="mt-8 overflow-hidden rounded-xl bg-surface">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
        </div>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-[4.5rem] rounded-none border-b border-border last:border-0 motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}
