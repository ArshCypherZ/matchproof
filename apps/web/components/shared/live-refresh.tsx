"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";

type RefreshState = "live" | "paused" | "retrying";

export function LiveRefresh({
  endpoint,
  label,
  interval = 5000,
}: {
  endpoint: string;
  label: string;
  interval?: number;
}) {
  const router = useRouter();
  const fingerprint = useRef<string | null>(null);
  const [state, setState] = useState<RefreshState>("live");
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      if (document.hidden) {
        setState("paused");
        return;
      }
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error("refresh failed");
        const body = await response.text();
        let next = body;
        try {
          next = JSON.stringify(JSON.parse(body), (key, value) =>
            key === "age_seconds" ? undefined : value,
          );
        } catch {
          // Non-JSON refresh endpoints use the response body as their fingerprint.
        }
        if (fingerprint.current && fingerprint.current !== next) {
          router.refresh();
          setAnnouncement(`${label} updated`);
        }
        fingerprint.current = next;
        failures = 0;
        setState("live");
        if (!stopped) timer = setTimeout(poll, interval);
      } catch {
        failures += 1;
        setState("retrying");
        if (!stopped)
          timer = setTimeout(poll, Math.min(interval * 2 ** failures, 30000));
      }
    };
    const handleVisibility = () => {
      if (timer) clearTimeout(timer);
      if (document.hidden) setState("paused");
      else void poll();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [endpoint, interval, label, router]);

  const Icon = state === "retrying" ? WifiOff : Radio;
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={`size-3.5 ${state === "live" ? "text-primary" : "text-warning"}`}
        />
        {state === "live"
          ? "Live updates"
          : state === "paused"
            ? "Updates paused"
            : "Reconnecting"}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
