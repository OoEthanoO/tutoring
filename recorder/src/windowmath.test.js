import { describe, expect, it } from "vitest";
import windowMath from "./windowmath.js";

const { matchesSharedWindow, cropWindowToDisplay, targetsMatch } = windowMath;

const display = { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
// A Retina display: 2880x1800 pixels of a 1440x900-point desktop.
const retina = { x: 0, y: 0, width: 2880, height: 1800, scaleFactor: 2 };

describe("matchesSharedWindow", () => {
  const shared = [{ id: 111, app: "Chrome", title: "Lesson slides" }];

  it("matches the window that was picked, by handle", () => {
    expect(matchesSharedWindow({ id: 111, app: "Chrome", title: "anything" }, shared)).toBe(true);
  });

  it("still matches after a restart, when the handle has changed", () => {
    expect(matchesSharedWindow({ id: 999, app: "Chrome", title: "Lesson slides" }, shared)).toBe(true);
  });

  it("does not match another window of the same app", () => {
    expect(matchesSharedWindow({ id: 999, app: "Chrome", title: "Bank" }, shared)).toBe(false);
  });

  it("never matches the recorder's own windows", () => {
    expect(matchesSharedWindow({ id: 111, app: "Chrome", title: "Lesson slides", own: true }, shared)).toBe(false);
  });

  it("does not let untitled windows match each other", () => {
    const untitled = [{ id: 5, app: "Notes", title: "" }];
    expect(matchesSharedWindow({ id: 6, app: "Notes", title: "" }, untitled)).toBe(false);
  });

  it("treats nothing shared as nothing recorded", () => {
    expect(matchesSharedWindow({ id: 1, app: "Chrome", title: "x" }, [])).toBe(false);
  });
});

describe("cropWindowToDisplay", () => {
  it("takes the window's rectangle relative to the display", () => {
    const crop = cropWindowToDisplay({ x: 100, y: 50, width: 800, height: 600 }, display, 120);
    expect(crop).toEqual({ x: 100, y: 50, width: 800, height: 600 });
  });

  it("offsets by a secondary display's origin", () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
    const crop = cropWindowToDisplay({ x: 2020, y: 10, width: 400, height: 300 }, second, 120);
    expect(crop).toEqual({ x: 100, y: 10, width: 400, height: 300 });
  });

  it("converts macOS points to capture pixels", () => {
    const crop = cropWindowToDisplay(
      { x: 100, y: 50, width: 640, height: 480, scaled: true },
      retina,
      120
    );
    expect(crop).toEqual({ x: 200, y: 100, width: 1280, height: 960 });
  });

  it("clamps a window hanging off the edge", () => {
    const crop = cropWindowToDisplay({ x: -200, y: 900, width: 800, height: 600 }, display, 120);
    expect(crop).toEqual({ x: 0, y: 900, width: 600, height: 180 });
  });

  it("gives up on a window that is mostly on another display", () => {
    expect(cropWindowToDisplay({ x: 1900, y: 10, width: 800, height: 600 }, display, 120)).toBeNull();
  });

  it("always returns even dimensions, which h.264 requires", () => {
    const crop = cropWindowToDisplay({ x: 0, y: 0, width: 801, height: 603 }, display, 120);
    expect(crop.width % 2).toBe(0);
    expect(crop.height % 2).toBe(0);
  });

  it("has nothing to crop without a display", () => {
    expect(cropWindowToDisplay({ x: 0, y: 0, width: 800, height: 600 }, null, 120)).toBeNull();
  });
});

describe("targetsMatch", () => {
  const at = (x) => ({ kind: "window", id: "7", crop: { x, y: 0, width: 800, height: 600 } });
  const settle = { driftTolerance: 3, settleMs: 1200, lastChangeMs: 1000 };

  it("keeps recording the same window in the same place", () => {
    expect(targetsMatch(at(100), at(100), { ...settle, now: 9000 })).toBe(true);
  });

  it("ignores a pixel or two of drift", () => {
    expect(targetsMatch(at(102), at(100), { ...settle, now: 9000 })).toBe(true);
  });

  it("restarts once a moved window has settled", () => {
    expect(targetsMatch(at(400), at(100), { ...settle, now: 9000 })).toBe(false);
  });

  it("leaves a window alone while it is being dragged", () => {
    expect(targetsMatch(at(400), at(100), { ...settle, now: 1500 })).toBe(true);
  });

  it("switches as soon as a different window takes focus", () => {
    const other = { kind: "window", id: "8", crop: { x: 100, y: 0, width: 800, height: 600 } };
    expect(targetsMatch(other, at(100), { ...settle, now: 1001 })).toBe(false);
  });

  it("switches between window and frozen regardless of timing", () => {
    expect(targetsMatch({ kind: "frozen" }, at(100), { ...settle, now: 1001 })).toBe(false);
    expect(targetsMatch(at(100), { kind: "frozen" }, { ...settle, now: 1001 })).toBe(false);
  });

  it("treats display and frozen segments as always current", () => {
    expect(targetsMatch({ kind: "display" }, { kind: "display" }, settle)).toBe(true);
    expect(targetsMatch({ kind: "frozen" }, { kind: "frozen" }, settle)).toBe(true);
  });

  it("stops when there is nothing to record, and starts when there is", () => {
    expect(targetsMatch(null, null, settle)).toBe(true);
    expect(targetsMatch(null, at(100), settle)).toBe(false);
    expect(targetsMatch(at(100), null, settle)).toBe(false);
  });
});
