import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="workspace-rail flex flex-col gap-8 py-10 md:flex-row md:items-end md:justify-between">
        <p className="text-sm font-semibold">Matchproof</p>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-muted-foreground"
        >
          {/* Coarse-pointer floors: the links stay visually the same quiet
              labels, but each gets a 44px hit area on touch. */}
          <Link
            href="/failure-scenarios"
            className="focus-ring flex items-center rounded-md px-1 py-1 transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Failure scenarios
          </Link>
          <Link
            href="/demo"
            className="focus-ring flex items-center rounded-md px-1 py-1 transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Test payment walkthrough
          </Link>
          <a
            href="/ledger-sample.csv"
            download
            className="focus-ring flex items-center rounded-md px-1 py-1 transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Ledger sample CSV
          </a>
          <Link
            href="/metrics"
            className="focus-ring flex items-center rounded-md px-1 py-1 transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            Metrics
          </Link>
        </nav>
      </div>
    </footer>
  );
}
