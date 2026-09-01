"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Health = "live" | "retrying" | "unavailable";

/**
 * The queue refreshes itself every few seconds and only re-renders when the
 * data actually changed — so the healthy state needs no label. The operator
 * gets exactly one control: pause, for when the queue must stop moving under
 * a selection. A reconnecting indicator appears only when the refresh is
 * actually failing, and every state change is announced politely.
 *
 * A polling endpoint can also answer 404 — the record it watches is gone.
 * `stopOnNotFound` opts a surface into that reading: polling stops, because
 * no retry can bring a deleted record back, and the notice says so instead
 * of counting reconnect attempts at it.
 */
export function LiveRefresh({
  endpoint,
  label,
  interval = 5000,
  stopOnNotFound = false,
}: {
  endpoint: string;
  label: string;
  interval?: number;
  stopOnNotFound?: boolean;
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
        if (stopOnNotFound && response.status === 404) {
          // Terminal: the record is gone, and re-announcing that on every
          // tab switch would shout. Say it once and stop the timer.
          const first = healthRef.current !== "unavailable";
          healthRef.current = "unavailable";
          setHealth("unavailable");
          if (first) announce(`${label} is no longer available`);
          return;
        }
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
        if (healthRef.current === "retrying") announce("Updates resumed");
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
  }, [endpoint, interval, label, router, paused, announce, stopOnNotFound]);

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
      announce("Updates resumed");
    } else {
      pausedRef.current = true;
      setPaused(true);
      announce("Updates paused");
    }
  };

  const reconnecting = health === "retrying" && !paused;
  const unavailable = health === "unavailable";

  return (
    <div className="flex items-center gap-1.5">
      {reconnecting ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-warning">
          <WifiOff aria-hidden="true" className="size-3.5" />
          Reconnecting
          <span className="font-data text-2xs tabular-nums">
            · {Math.max(1, Math.round(retryWait / 1000))}s
          </span>
        </span>
      ) : null}
      {unavailable ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <WifiOff aria-hidden="true" className="size-3.5" />
          No longer available
        </span>
      ) : null}
      {!unavailable ? (
        paused ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={togglePause}
            data-icon="inline-start"
          >
            <Play aria-hidden="true" className="size-3.5" />
            Paused
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={togglePause}
            aria-label={`Pause ${label.toLowerCase()} updates`}
            title={`Pause ${label.toLowerCase()} updates`}
          >
            <Pause aria-hidden="true" />
          </Button>
        )
      ) : null}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
