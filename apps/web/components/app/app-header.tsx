import Link from "next/link";
import { PrimaryNav } from "@/components/app/primary-nav";
import { PullCordSlot } from "@/components/app/pull-cord-slot";
import { Logo } from "@/components/app/logo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="page-rail reserve-cord grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 sm:flex sm:h-16 sm:gap-6 sm:py-0">
        <Link
          href="/incidents"
          aria-label="Matchproof, home"
          className="focus-ring flex shrink-0 items-center gap-2 rounded-md"
        >
          <div className="grid size-8 place-items-center">
            <Logo className="size-full" />
          </div>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Matchproof
          </span>
        </Link>

        <PrimaryNav />
      </div>
      <div
        className="sr-only"
        aria-atomic="true"
        aria-live="polite"
        id="app-live-region"
      />
      <PullCordSlot />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-2 right-16 hidden w-8 bg-gradient-to-l from-background via-background/80 to-transparent sm:block md:hidden"
      />
    </header>
  );
}
