"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Radio, RefreshCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Health = "live" | "retrying";

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
  const [paused, setPaused] = useState(false);
  const [health, setHealth] = useState<Health>("live");
  const [announcement, setAnnouncement] = useState("");
  const [retryWait, setRetryWait] = useState(0);

  const pausedRef = useRef(false);
  const healthRef = useRef<Health>("live");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stoppedRef = useRef(false);
  const pollNowRef = useRef<() => void>(() => {});

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
    // A trailing clear lets the same state recur (pause → live → pause)
    // announce again on the polite live region.
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => setAnnouncement(""), 1200);
  }, []);

  useEffect(() => {
    let failures = 0;
    stoppedRef.current = false;

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };

    const backoffDelay = () => Math.min(interval * 2 ** failures, 30000);

    const runPoll = async () => {
      if (document.hidden) return;
      let ok = false;
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
          announce(`${label} updated`);
        }
        fingerprint.current = next;
        ok = true;
        failures = 0;
        setRetryWait(0);
        if (healthRef.current === "retrying") announce("Live updates resumed");
        healthRef.current = "live";
        setHealth("live");
      } catch {
        failures += 1;
        const wait = backoffDelay();
        setRetryWait(wait);
        if (healthRef.current === "live") announce("Reconnecting");
        healthRef.current = "retrying";
        setHealth("retrying");
      }
      if (stoppedRef.current || pausedRef.current || document.hidden) return;
      const delay = ok ? interval : backoffDelay();
      timerRef.current = setTimeout(() => void runPoll(), delay);
    };

    pollNowRef.current = () => {
      clearTimer();
      // A manual refresh says what it found even when nothing changed, so
      // the button press always produces feedback.
      const before = fingerprint.current;
      return runPoll().then(() => {
        if (fingerprint.current === before) announce("No changes");
      });
    };

    const handleVisibility = () => {
      clearTimer();
      if (!document.hidden && !pausedRef.current) void runPoll();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    if (!pausedRef.current && !document.hidden) void runPoll();

    return () => {
      stoppedRef.current = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [endpoint, interval, label, router, paused, announce]);

  useEffect(
    () => () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    },
    [],
  );

  const togglePause = () => {
    if (pausedRef.current) {
      // Clear any stale retry state so the resume announcement stays single.
      healthRef.current = "live";
      setHealth("live");
      setRetryWait(0);
      pausedRef.current = false;
      setPaused(false);
      announce("Live updates resumed");
    } else {
      pausedRef.current = true;
      setPaused(true);
      announce("Updates paused");
    }
  };

  const Icon = paused ? Pause : health === "retrying" ? WifiOff : Radio;
  const iconTone = paused
    ? "text-muted-foreground"
    : health === "retrying"
      ? "text-warning"
      : "text-primary";
  const statusText = paused
    ? "Updates paused"
    : health === "retrying"
      ? "Reconnecting"
      : "Live updates";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon aria-hidden="true" className={`size-3.5 ${iconTone}`} />
          {statusText}
          {health === "retrying" && !paused ? (
            <span className="font-data text-2xs">
              · {Math.max(1, Math.round(retryWait / 1000))}s
            </span>
          ) : null}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={togglePause}
          className="font-data uppercase tracking-[0.08em]"
        >
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => pollNowRef.current()}
          data-icon="inline-start"
          className="font-data uppercase tracking-[0.08em]"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Refresh
        </Button>
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
