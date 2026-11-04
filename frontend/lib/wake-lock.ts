import { useEffect, useState } from "react";

/**
 * Keep the screen on while `active`, so a projector laptop's screen saver, an
 * operator phone's auto-lock, or an attendee's dimming screen doesn't cut the
 * microphone or hide the captions mid-khutbah.
 *
 * Browsers release the lock whenever the page is hidden, so it is requested
 * again each time the page becomes visible. Returns whether the lock is held:
 * null while inactive, false if the browser refused or lacks the API.
 */
export function useScreenWakeLock(active: boolean): boolean | null {
  const [held, setHeld] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active) {
      setHeld(null);
      return;
    }
    if (!("wakeLock" in navigator)) {
      setHeld(false);
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function request() {
      if (cancelled || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
        setHeld(true);
        next.addEventListener("release", () => { if (!cancelled && sentinel === next) setHeld(false); });
      } catch {
        // Refused, e.g. by battery saver; the caller tells the user instead.
        if (!cancelled) setHeld(false);
      }
    }

    const onVisibility = () => { void request(); };
    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
    };
  }, [active]);

  return held;
}
