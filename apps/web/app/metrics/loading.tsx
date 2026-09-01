import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  // The shell mirrors the real header and band geometry — same border and
  // paddings, same action row on phones, same section-heading offset — so
  // the streamed page lands without a jump at any width.
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
          <Skeleton className="h-9 w-40 sm:h-10 motion-reduce:animate-none" />
          <Skeleton className="mt-1 h-5 w-full max-w-xl motion-reduce:animate-none" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The pause control and the outline button, at their real sizes:
              24px each on a fine pointer, the 44px aim floor on touch. */}
          <Skeleton className="size-6 rounded-md pointer-coarse:h-11 pointer-coarse:min-w-11 motion-reduce:animate-none" />
          <Skeleton className="h-8 w-52 rounded-lg max-sm:w-full max-sm:flex-1 pointer-coarse:h-11 pointer-coarse:min-w-11 motion-reduce:animate-none" />
        </div>
      </div>
      <section className="mt-10">
        <div className="mb-7">
          <Skeleton className="h-7 w-44 motion-reduce:animate-none" />
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="py-3">
              <Skeleton className="h-10 w-24 motion-reduce:animate-none" />
              <Skeleton className="mt-2 h-4 w-32 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
