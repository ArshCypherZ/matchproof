"use client";

import dynamic from "next/dynamic";

// The cord springs on the motion library, which would otherwise ride along
// in every route's first script bundle. It mounts after hydration (the cord
// stays hidden until then anyway), so it loads in its own chunk. The
// dynamic import must sit in a client component for the split to happen.
const PullCord = dynamic(
  () => import("./pull-cord").then((mod) => ({ default: mod.PullCord })),
  { ssr: false },
);

export function PullCordSlot() {
  return <PullCord />;
}
