"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/incidents", label: "Exceptions" },
  { href: "/batches", label: "Batches" },
  { href: "/metrics", label: "Metrics" },
  { href: "/ledger", label: "Ledger" },
];

export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary navigation"
      className="col-span-2 row-start-2 flex w-full min-w-0 max-w-full items-center justify-start gap-0 overflow-x-auto overscroll-x-contain snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:gap-1"
    >
      {navItems.map((item) => {
        const current =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`focus-ring flex shrink-0 snap-start items-center rounded-md px-1 py-2 text-xs transition-colors hover:bg-muted hover:text-foreground sm:px-3 sm:text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center ${current ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
