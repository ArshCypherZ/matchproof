import { Skeleton } from "@/components/ui/skeleton";

/* The shared PageSkeleton is a queue's shape: one header plus a tall table
   card. This page is a form card at task measure plus a 3×2 field of boxed
   cells, so its loading state mirrors that geometry — same rails, chapter
   turns, and cell boxes — and the stream swap moves as little as possible. */
export default function Loading() {
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
      {/* The real header: title row with its count chip, subtitle one step
          below, the action slot moving beside the title at sm, closed by the
          one permitted hairline. */}
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <Skeleton className="h-9 w-52 motion-reduce:animate-none" />
            <Skeleton className="h-8 w-44 rounded-md motion-reduce:animate-none" />
          </div>
          <Skeleton className="mt-1 h-5 w-full max-w-xl motion-reduce:animate-none" />
        </div>
        <Skeleton className="h-8 w-40 max-sm:w-full motion-reduce:animate-none" />
      </div>
      {/* The import card keeps the task measure it holds when loaded. */}
      <div className="mt-10 max-w-2xl overflow-hidden rounded-xl bg-surface p-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-10 w-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-64 motion-reduce:animate-none" />
        </div>
      </div>
      {/* The reference field: the same 1/2/3 column ladder and boxed cells
          the definitions land in. */}
      <div className="mt-10">
        <Skeleton className="h-6 w-36 motion-reduce:animate-none" />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="rounded-xl bg-surface px-4 py-4 sm:px-5"
            >
              <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
              <Skeleton className="mt-2 h-4 w-full motion-reduce:animate-none" />
              <Skeleton className="mt-2 h-4 w-2/3 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
