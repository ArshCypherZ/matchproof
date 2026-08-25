"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/incidents", label: "Incidents" },
  { href: "/batches", label: "Batches" },
  { href: "/metrics", label: "Metrics" },
];

export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary navigation"
      className="flex min-w-0 items-center gap-1"
    >
      {navItems.map((item) => {
        const current =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`focus-ring rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted hover:text-foreground ${current ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
