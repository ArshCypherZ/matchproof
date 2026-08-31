"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";

const WIDTH = 72;
const ANCHOR_X = WIDTH / 2;
const ANCHOR_Y = 8;
const REST_LENGTH = 64;
const MAX_PULL = 130;
const MAX_SWAY = 34;
const PULL_THRESHOLD = 66;
const HEIGHT = REST_LENGTH + MAX_PULL + 30;
const HANDLE_HIT_SIZE = 44;

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const subscribeToTheme = (callback: () => void) => {
  window.addEventListener("app-theme-change", callback);
  return () => window.removeEventListener("app-theme-change", callback);
};
const getThemeSnapshot = () =>
  document.documentElement.classList.contains("dark");
const getServerThemeSnapshot = () => false;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

type ViewTransition = {
  ready: Promise<void>;
  finished: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransition;
};

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  window.dispatchEvent(new Event("app-theme-change"));
  try {
    window.localStorage.setItem("app-theme", theme);
  } catch {}

  const liveRegion = document.getElementById("app-live-region");
  if (liveRegion)
    liveRegion.textContent = `${theme === "dark" ? "Dark" : "Light"} theme enabled`;
}

export function PullCord() {
  const reduceMotion = useReducedMotion();
  const mounted = React.useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = React.useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const busy = React.useRef(false);
  const dragging = React.useRef(false);
  const dragged = React.useRef(false);
  const suppressClick = React.useRef(false);
  const origin = React.useRef({ x: 0, y: 0 });
  const beadRef = React.useRef<SVGCircleElement>(null);

  const pullX = useMotionValue(0);
  const pullY = useMotionValue(0);
  const springX = useSpring(pullX, { stiffness: 180, damping: 12, mass: 0.9 });
  const springY = useSpring(pullY, { stiffness: 300, damping: 10, mass: 0.9 });

  const cordPath = useTransform<number, string>(
    [springX, springY],
    ([x, y]: number[]) => {
      const beadX = ANCHOR_X + x;
      const beadY = REST_LENGTH + y;
      const controlX = ANCHOR_X + x * 0.55;
      const controlY = ANCHOR_Y + (beadY - ANCHOR_Y) * 0.55;
      return `M ${ANCHOR_X} ${ANCHOR_Y} Q ${controlX} ${controlY} ${beadX} ${beadY}`;
    },
  );
  const beadX = useTransform(springX, (x) => ANCHOR_X + x);
  const beadY = useTransform(springY, (y) => REST_LENGTH + y);

  const flipTheme = React.useCallback(() => {
    if (busy.current) return;

    const root = document.documentElement;
    const nextTheme = root.classList.contains("dark") ? "light" : "dark";
    const rect = beadRef.current?.getBoundingClientRect();
    const originX = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
    const originY = rect ? rect.top + rect.height / 2 : 40;
    const transitionDocument = document as ViewTransitionDocument;
    const startViewTransition =
      transitionDocument.startViewTransition?.bind(document);
    const updateTheme = () => applyTheme(nextTheme);

    if (reduceMotion || !startViewTransition) {
      updateTheme();
      return;
    }

    busy.current = true;
    const transition = startViewTransition(() => {
      flushSync(updateTheme);
    });

    void transition.ready
      .then(() => {
        const endRadius = Math.hypot(
          Math.max(originX, window.innerWidth - originX),
          Math.max(originY, window.innerHeight - originY),
        );
        root.animate(
          {
            clipPath: [
              `circle(0px at ${originX}px ${originY}px)`,
              `circle(${endRadius}px at ${originX}px ${originY}px)`,
            ],
          },
          {
            duration: 550,
            easing: "cubic-bezier(0.77, 0, 0.175, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => undefined);

    const finishTransition = () => {
      busy.current = false;
    };
    void transition.finished.then(finishTransition, finishTransition);
  }, [reduceMotion]);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      const deltaX = event.clientX - origin.current.x;
      const deltaY = event.clientY - origin.current.y;
      if (Math.hypot(deltaX, deltaY) > 3) dragged.current = true;
      pullX.set(clamp(deltaX, -MAX_SWAY, MAX_SWAY));
      pullY.set(clamp(deltaY, 0, MAX_PULL));
    };

    const end = (shouldActivate: boolean) => {
      if (!dragging.current) return;
      dragging.current = false;
      const pulledFarEnough = pullY.get() >= PULL_THRESHOLD;
      suppressClick.current = dragged.current;
      pullX.set(0);
      pullY.set(0);
      if (shouldActivate && pulledFarEnough) flipTheme();
    };

    const handlePointerUp = () => end(true);
    const handlePointerCancel = () => end(false);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("blur", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("blur", handlePointerCancel);
    };
  }, [flipTheme, pullX, pullY]);

  if (!mounted) return null;

  const actionLabel = isDark
    ? "Pull cord to turn the lights on"
    : "Pull cord to turn the lights off";

  return (
    <div className="theme-pull-cord" style={{ width: WIDTH, height: HEIGHT }}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
        aria-hidden="true"
      >
        <circle className="pull-cord-glow" cx={ANCHOR_X} cy={ANCHOR_Y} r={18} />
        <path className="pull-cord-socket" d="M27 0h18v7a9 9 0 0 1-18 0V0Z" />
        <motion.path
          className="pull-cord-line"
          d={cordPath}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <motion.circle
          ref={beadRef}
          className="pull-cord-bead"
          cx={beadX}
          cy={beadY}
          r={8}
        />
        <motion.circle
          className="pull-cord-bead-highlight"
          cx={beadX}
          cy={beadY}
          r={2.5}
        />
      </svg>
      <motion.button
        type="button"
        className="pull-cord-control"
        style={{
          left: ANCHOR_X - HANDLE_HIT_SIZE / 2,
          top: REST_LENGTH - HANDLE_HIT_SIZE / 2,
          x: springX,
          y: springY,
        }}
        aria-label={actionLabel}
        title={actionLabel}
        onPointerDown={(event) => {
          if (busy.current) return;
          dragging.current = true;
          dragged.current = false;
          suppressClick.current = false;
          origin.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          flipTheme();
        }}
      />
    </div>
  );
}
