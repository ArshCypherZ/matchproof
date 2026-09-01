"use client";

import { useEffect, useRef, useState } from "react";

// Bezier evaluation for cubic-bezier(0.2, 0, 0, 1) — the JS twin of
// --motion-ease-out, so the count eases on the same curve as every CSS
// transition. Newton-solves the x(t) parameter for a linear progress.
function motionEaseOut(progress: number) {
  const x1 = 0.2;
  let t = progress;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const oneMinusT = 1 - t;
    const x = 3 * oneMinusT ** 2 * t * x1 + t ** 3;
    const derivative = 3 * oneMinusT * (oneMinusT - 2 * t) * x1 + 3 * t ** 2;
    if (derivative === 0) break;
    t -= (x - progress) / derivative;
  }
  t = Math.min(1, Math.max(0, t));
  const oneMinusT = 1 - t;
  return 3 * oneMinusT * t ** 2 + t ** 3;
}

/**
 * A live number that counts to its next value so a silent refresh
 * becomes a visible tick. Renders the exact value on the server and
 * whenever the visitor prefers reduced motion. A refresh that lands
 * mid-count continues from the number on screen, never snapping back.
 */
export function Tally({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const shown = useRef(value);

  useEffect(() => {
    const start = shown.current;
    if (start === value) return;
    let frame = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      frame = requestAnimationFrame(() => {
        shown.current = value;
        setDisplay(value);
      });
      return () => cancelAnimationFrame(frame);
    }
    // --motion-duration-slow: the one slow thing on a dashboard is a
    // number settling into place.
    const duration = 420;
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - began) / duration, 1);
      const next = Math.round(
        start + (value - start) * motionEaseOut(progress),
      );
      shown.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className="tabular-nums">{display}</span>;
}
