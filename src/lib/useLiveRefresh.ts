"use client";

import { useEffect, useMemo, useRef } from "react";

/** How often a page that shows live data asks the server again while it is on screen. */
export const LIVE_REFRESH_MS = 5000;

type LiveRefreshOptions = {
  /** Polls only while true (for example once the viewer is known to be allowed to see the list). */
  enabled?: boolean;
  intervalMs?: number;
};

/**
 * Keeps a list current without a page reload. The site has no push channel (the database is
 * self-hosted PostgREST, without Supabase Realtime), so this asks again: every `intervalMs`
 * while the tab is visible, and at once when the tab becomes visible again or the window gets
 * focus. A hidden tab does not poll, and a call never overlaps the one before it.
 *
 * The component still does its own first load; this only covers the refreshes after it.
 * `refresh` may change on every render: the latest one is always called.
 */
export function useLiveRefresh(
  refresh: () => Promise<unknown> | unknown,
  { enabled = true, intervalMs = LIVE_REFRESH_MS }: LiveRefreshOptions = {}
) {
  const latest = useRef(refresh);

  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let running = false;
    let stopped = false;

    const tick = async () => {
      if (running || stopped || document.visibilityState === "hidden") {
        return;
      }
      running = true;
      try {
        await latest.current();
      } catch {
        // A failed refresh is simply tried again on the next tick.
      } finally {
        running = false;
      }
    };
    const onReturn = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };

    const timer = window.setInterval(() => void tick(), intervalMs);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [enabled, intervalMs]);
}

/**
 * Stops a refresh from undoing the viewer's own change. Wrap each change in `begin()`/`end()`,
 * take a `snapshot()` before reading the list, and apply what was read only if
 * `stillCurrent(snapshot)`: no change was saving when the read finished, and none started or
 * finished while it was under way. A read that fails the check is dropped; the next one is current.
 */
export function useChangeGuard() {
  const state = useRef({ inFlight: 0, version: 0 });
  return useMemo(
    () => ({
      begin() {
        state.current.inFlight += 1;
        state.current.version += 1;
      },
      end() {
        state.current.inFlight -= 1;
        state.current.version += 1;
      },
      snapshot() {
        return state.current.version;
      },
      stillCurrent(snapshot: number) {
        return state.current.inFlight === 0 && state.current.version === snapshot;
      },
    }),
    []
  );
}
