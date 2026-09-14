// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("recorder/src/overlay.html", "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const pillSize = { width: 148, height: 52 };
const recording = {
  mode: "recording", title: "REC {elapsed}", detail: "Test class",
  blocking: false, corner: "bottom-right", recordingSinceMs: 1000,
};
const paused = { ...recording, mode: "paused", title: "RECORDING PAUSED", blocking: true };
let invoke, onState;
const flush = () => vi.advanceTimersByTimeAsync(0);
const show = async state => { onState({ payload: state }); await flush(); };
const resizeCalls = () => invoke.mock.calls.filter(([command]) => command === "resize_overlay");

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)[1];
  // jsdom has no layout engine. Keep the measured pill identical before and
  // after the banner: that is the case which previously skipped the resize.
  document.getElementById("pill").getBoundingClientRect = () => pillSize;
  invoke = vi.fn(async command => command === "get_overlay_state" ? recording : undefined);
  window.__TAURI__ = {
    core: { invoke },
    event: { listen: vi.fn(async (event, handler) => { if (event === "overlay-state") onState = handler; }) },
  };
  window.eval(source);
  await flush();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete window.__TAURI__;
  document.body.innerHTML = "";
});

describe("overlay window sizing", () => {
  it.each(["bottom-right", "bottom-left", "top-right", "top-left"])(
    "shrinks back to the measured REC pill after repeated pauses in %s",
    async corner => {
      expect(resizeCalls()).toEqual([["resize_overlay", pillSize]]);
      for (let cycle = 0; cycle < 3; cycle++) {
        invoke.mockClear();
        await show({ ...paused, corner });
        expect(document.getElementById("banner").hidden).toBe(false);
        expect(resizeCalls()).toHaveLength(0);

        await show({ ...recording, corner });
        expect(document.getElementById("banner").hidden).toBe(true);
        expect(document.getElementById("pill").hidden).toBe(false);
        // resize_overlay also repositions the native window using the saved
        // corner, so it must run even when the pill's text dimensions match.
        expect(resizeCalls()).toEqual([["resize_overlay", pillSize]]);
      }
    },
  );

  it("restores the small window after a banner is hidden before recording resumes", async () => {
    await show(paused);
    await show({ mode: "hidden" });
    invoke.mockClear();
    await show(recording);
    expect(resizeCalls()).toEqual([["resize_overlay", pillSize]]);
  });

  it("does not resize unchanged pill-only updates", async () => {
    invoke.mockClear();
    await show(recording);
    await show({ ...recording, title: "REC 0:02" });
    expect(resizeCalls()).toHaveLength(0);
  });
});
