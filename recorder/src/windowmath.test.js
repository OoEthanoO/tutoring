import { describe, expect, it } from "vitest";
import windowMath from "./windowmath.js";

const { matchesSharedWindow, targetsMatch } = windowMath;

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

describe("targetsMatch", () => {
  const sized = (width, height = 600) => ({ kind: "window", id: "7", size: { width, height } });
  const settle = { driftTolerance: 3, settleMs: 1200, lastChangeMs: 1000 };

  it("keeps recording the same window at the same size", () => {
    expect(targetsMatch(sized(800), sized(800), { ...settle, now: 9000 })).toBe(true);
  });

  it("ignores a pixel or two of size drift", () => {
    expect(targetsMatch(sized(802), sized(800), { ...settle, now: 9000 })).toBe(true);
  });

  it("does not restart when a window only moves — the capture follows it", () => {
    const moved = { ...sized(800), x: 900, y: 400 };
    expect(targetsMatch(moved, { ...sized(800), x: 0, y: 0 }, { ...settle, now: 9000 })).toBe(true);
  });

  it("restarts once a resized window has settled, to fit the new shape", () => {
    expect(targetsMatch(sized(400, 900), sized(800), { ...settle, now: 9000 })).toBe(false);
  });

  it("leaves a window alone while it is being resized", () => {
    expect(targetsMatch(sized(400, 900), sized(800), { ...settle, now: 1500 })).toBe(true);
  });

  it("switches as soon as a different window takes focus", () => {
    const other = { kind: "window", id: "8", size: { width: 800, height: 600 } };
    expect(targetsMatch(other, sized(800), { ...settle, now: 1001 })).toBe(false);
  });

  it("switches between window and frozen regardless of timing", () => {
    expect(targetsMatch({ kind: "frozen" }, sized(800), { ...settle, now: 1001 })).toBe(false);
    expect(targetsMatch(sized(800), { kind: "frozen" }, { ...settle, now: 1001 })).toBe(false);
  });

  it("treats display and frozen segments as always current", () => {
    expect(targetsMatch({ kind: "display" }, { kind: "display" }, settle)).toBe(true);
    expect(targetsMatch({ kind: "frozen" }, { kind: "frozen" }, settle)).toBe(true);
  });

  it("stops when there is nothing to record, and starts when there is", () => {
    expect(targetsMatch(null, null, settle)).toBe(true);
    expect(targetsMatch(null, sized(800), settle)).toBe(false);
    expect(targetsMatch(sized(800), null, settle)).toBe(false);
  });
});

describe("targetsMatch and muting", () => {
  const win = (muted) => ({
    kind: "window",
    id: "7",
    muted,
    size: { width: 800, height: 600 },
  });

  it("restarts the segment when the tutor mutes", () => {
    expect(targetsMatch(win(true), win(false), { now: 9000 })).toBe(false);
  });

  it("restarts again when they unmute", () => {
    expect(targetsMatch(win(false), win(true), { now: 9000 })).toBe(false);
  });

  it("leaves it alone when the mute has not changed", () => {
    expect(targetsMatch(win(true), win(true), { now: 9000 })).toBe(true);
  });

  it("applies to display and frozen segments too", () => {
    expect(targetsMatch({ kind: "display", muted: true }, { kind: "display", muted: false })).toBe(false);
    expect(targetsMatch({ kind: "frozen", muted: true }, { kind: "frozen", muted: true })).toBe(true);
  });

  it("treats a missing mute flag as not muted", () => {
    expect(targetsMatch({ kind: "display" }, { kind: "display", muted: false })).toBe(true);
    expect(targetsMatch({ kind: "display" }, { kind: "display", muted: true })).toBe(false);
  });
});
