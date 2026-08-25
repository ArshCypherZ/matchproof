import Link from "next/link";
import {
  Activity,
  CircleUserRound,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import { PrimaryNav } from "@/components/app/primary-nav";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href="/incidents"
          className="focus-ring flex shrink-0 items-center gap-2 rounded-md"
        >
          <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            O2
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            O2 Controller
          </span>
        </Link>

        <PrimaryNav />

        <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 sm:flex">
            <GitBranch aria-hidden="true" className="size-3.5 text-primary" />
            <span>Fixture rehearsal</span>
          </span>
          <span className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 md:flex">
            <Activity aria-hidden="true" className="size-3.5 text-provider" />
            <span>Connected</span>
          </span>
          <span
            className="flex size-8 items-center justify-center rounded-md border border-border bg-surface"
            title="Operator workspace"
          >
            <CircleUserRound aria-hidden="true" className="size-4" />
            <span className="sr-only">Operator workspace</span>
          </span>
        </div>
      </div>
      <div className="sr-only" aria-live="polite" id="app-live-region">
        <ShieldCheck aria-hidden="true" />
      </div>
    </header>
  );
}
