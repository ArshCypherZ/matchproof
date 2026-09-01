import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  // The shell mirrors the real header and card geometry — same border and
  // paddings, same action stack on phones, same card offset — so the
  // streamed page lands without a jump at any width.
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
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <Skeleton className="h-9 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-5 w-14 motion-reduce:animate-none" />
          </div>
          <Skeleton className="mt-1 h-5 w-full max-w-md motion-reduce:animate-none" />
        </div>
        <div className="flex flex-col items-start gap-2 max-sm:w-full">
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            {/* The pause control the live header carries (icon-xs sizing). */}
            <Skeleton className="size-6 rounded-md motion-reduce:animate-none" />
            <Skeleton className="h-8 w-36 max-sm:w-full motion-reduce:animate-none" />
            <Skeleton className="h-8 w-28 max-sm:w-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-4 w-64 max-sm:w-full motion-reduce:animate-none" />
        </div>
      </div>
      <div className="mt-10 overflow-hidden rounded-xl bg-surface">
        <Skeleton className="h-[3.25rem] rounded-none border-b border-border motion-reduce:animate-none" />
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-[4.5rem] rounded-none border-b border-border last:border-0 motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}
