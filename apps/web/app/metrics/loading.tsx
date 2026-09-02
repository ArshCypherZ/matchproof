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
        Loading metrics…
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
        {/* The live strip's exact geometry, not an approximation of it: one
            surface card in the strip's own ladder (one column below sm, two
            from sm, five at lg), cells at the band's real px-4 py-4, and
            value/label bars at the real line heights (text-4xl/5xl leading,
            then text-sm) — so the streamed band lands where the skeleton
            stood, at any width. */}
        <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-surface sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="px-4 py-4">
              <Skeleton className="h-10 w-24 lg:h-12 motion-reduce:animate-none" />
              <Skeleton className="mt-2 h-5 w-32 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
