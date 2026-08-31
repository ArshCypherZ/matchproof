import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="page-rail flex flex-col gap-8 py-10 md:flex-row md:items-end md:justify-between">
        <p className="font-data text-xs font-semibold text-foreground">
          Matchproof
        </p>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-center gap-x-5 gap-y-3 font-data text-xs text-ink-secondary"
        >
          {/* Coarse-pointer floors: the links stay visually the same quiet
              typewriter labels, but each gets a 44px hit area on touch. */}
          <Link
            href="/failure-scenarios"
            className="focus-ring flex items-center rounded-sm px-1 py-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Failure scenarios
          </Link>
          <Link
            href="/demo"
            className="focus-ring flex items-center rounded-sm px-1 py-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Test payment walkthrough
          </Link>
          <a
            href="/ledger-sample.csv"
            download
            className="focus-ring flex items-center rounded-sm px-1 py-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Ledger sample CSV
          </a>
          <Link
            href="/metrics"
            className="focus-ring flex items-center rounded-sm px-1 py-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Metrics
          </Link>
        </nav>
      </div>
    </footer>
  );
}
