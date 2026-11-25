// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REFRESH_MS, useChangeGuard, useLiveRefresh } from "./useLiveRefresh";

let root: Root, container: HTMLDivElement;
let visibility: DocumentVisibilityState = "visible";

function Probe({ refresh, enabled = true }: { refresh: () => unknown; enabled?: boolean }) {
  useLiveRefresh(refresh, { enabled });
  return null;
}

const setVisibility = async (value: DocumentVisibilityState) => {
  visibility = value;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};
const wait = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLiveRefresh", () => {
  it("refreshes every few seconds while the page is on screen, not at mount", async () => {
    const refresh = vi.fn();
    await act(async () => root.render(<Probe refresh={refresh} />));
    expect(refresh).not.toHaveBeenCalled();
    await wait(LIVE_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    await wait(LIVE_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("stops in a hidden tab and catches up the moment the tab is back", async () => {
    const refresh = vi.fn();
    await act(async () => root.render(<Probe refresh={refresh} />));
    await setVisibility("hidden");
    await wait(LIVE_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    await setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the window gets focus", async () => {
    const refresh = vi.fn();
    await act(async () => root.render(<Probe refresh={refresh} />));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never starts a refresh while the previous one is still running", async () => {
    let finish = () => {};
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => root.render(<Probe refresh={refresh} />));
    await wait(LIVE_REFRESH_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await wait(LIVE_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps going after a refresh fails", async () => {
    const refresh = vi.fn(async () => { throw new Error("offline"); });
    await act(async () => root.render(<Probe refresh={refresh} />));
    await wait(LIVE_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does nothing while disabled, and stops when the page goes away", async () => {
    const refresh = vi.fn();
    await act(async () => root.render(<Probe refresh={refresh} enabled={false} />));
    await wait(LIVE_REFRESH_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe refresh={refresh} />));
    await wait(LIVE_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<></>));
    await wait(LIVE_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("useChangeGuard", () => {
  type Guard = ReturnType<typeof useChangeGuard>;
  let guard: Guard;
  const keep = (value: Guard) => { guard = value; };
  function Holder({ onGuard }: { onGuard: (value: Guard) => void }) {
    const value = useChangeGuard();
    useEffect(() => onGuard(value), [onGuard, value]);
    return null;
  }

  it("keeps a read that overlapped no change, and drops one that overlapped a change", async () => {
    await act(async () => root.render(<Holder onGuard={keep} />));
    const quiet = guard.snapshot();
    expect(guard.stillCurrent(quiet)).toBe(true);

    // The read finished while the change was still saving.
    const during = guard.snapshot();
    guard.begin();
    expect(guard.stillCurrent(during)).toBe(false);
    // A read that starts while the change is saving is no better.
    const startedDuring = guard.snapshot();
    guard.end();
    expect(guard.stillCurrent(startedDuring)).toBe(false);
    // Once it is saved, a new read is fine again.
    expect(guard.stillCurrent(guard.snapshot())).toBe(true);
  });

  it("is the same object for the life of the page", async () => {
    await act(async () => root.render(<Holder onGuard={keep} />));
    const first = guard;
    await act(async () => root.render(<Holder onGuard={keep} />));
    expect(guard).toBe(first);
  });
});
