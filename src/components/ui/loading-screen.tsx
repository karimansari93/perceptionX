import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  className?: string;
  /** When true, the bar snaps to 100% and the screen fades out. */
  completing?: boolean;
}

/**
 * Module-level progress clock so the bar is continuous across the
 * multiple LoadingScreen mounts in one login (Auth -> ProtectedRoute ->
 * Dashboard) and across any flicker of the loading condition. CSS
 * keyframes restart on remount; an elapsed-time clock does not.
 */
let barStart = 0;
let barLastTick = 0;
const NEW_SEQUENCE_GAP_MS = 4000; // no loading screen for this long => fresh login
const TIME_CONSTANT_MS = 2600; // controls how fast the trickle decelerates
const MAX_PROGRESS = 0.92; // never reach 100% until completion

function readProgress(): number {
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (barStart === 0 || now - barLastTick > NEW_SEQUENCE_GAP_MS) {
    barStart = now;
  }
  barLastTick = now;
  const elapsed = now - barStart;
  const p = 1 - Math.exp(-elapsed / TIME_CONSTANT_MS);
  return Math.min(MAX_PROGRESS, p);
}

/** Reset so the next login starts the bar from 0. */
export function resetLoadingBar() {
  barStart = 0;
  barLastTick = 0;
}

export function LoadingScreen({ className, completing = false }: LoadingScreenProps) {
  const [progress, setProgress] = useState(() => readProgress());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (completing) return; // freeze trickle; completion handles the rest
    const tick = () => {
      setProgress(readProgress());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [completing]);

  // When the whole sequence finishes, reset so the next login starts fresh.
  useEffect(() => {
    if (!completing) return;
    const t = setTimeout(resetLoadingBar, 600);
    return () => clearTimeout(t);
  }, [completing]);

  const scaleX = completing ? 1 : progress;

  return (
    <div
      className={cn(
        "min-h-screen w-screen flex items-center justify-center bg-white",
        completing && "animate-loadingScreenFadeOut",
        className
      )}
    >
      <div className="flex flex-col items-center">
        <img
          src="/logos/PerceptionX-PrimaryLogo.png"
          alt="PerceptionX"
          className="h-10 object-contain"
        />
        <div className="mt-5 w-64 h-[3px] bg-nightsky/10 rounded-full overflow-hidden">
          <div
            className="h-full w-full bg-nightsky rounded-full origin-left"
            style={{
              transform: `scaleX(${scaleX})`,
              transition: completing ? "transform 0.3s cubic-bezier(0.4,0,0.2,1)" : "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Keeps a loading screen visible long enough to play its completion
 * (snap-to-100% + fade) after the underlying data is ready.
 *
 * Usage:
 *   const { show, completing } = useLoadingHandoff(isLoading);
 *   if (show) return <LoadingScreen completing={completing} />;
 */
export function useLoadingHandoff(
  isLoading: boolean,
  { stableMs = 500 }: { stableMs?: number } = {}
) {
  const [show, setShow] = useState(isLoading);
  const [completing, setCompleting] = useState(false);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      // (Re)entered loading — including a flicker back from a false-positive
      // "ready". Cancel any pending completion and keep the loader up.
      if (completeTimer.current) clearTimeout(completeTimer.current);
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      setCompleting(false);
      setShow(true);
      return;
    }
    // isLoading === false: only treat as truly ready if it STAYS false for
    // stableMs. A flicker back to loading clears this timer (above).
    if (completeTimer.current) clearTimeout(completeTimer.current);
    completeTimer.current = setTimeout(() => {
      setCompleting(true);
      unmountTimer.current = setTimeout(() => {
        setShow(false);
      }, 550);
    }, stableMs);
    return () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
    };
  }, [isLoading, stableMs]);

  useEffect(
    () => () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
    },
    []
  );

  return { show, completing };
}
