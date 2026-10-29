import { describe, expect, it } from "vitest";
import windowMath from "./windowmath.js";

const { sameWindow, matchesSharedWindow, pickerLabels, targetsMatch } = windowMath;

describe("sameWindow", () => {
  it("is the same window when the handle matches, whatever the title says", () => {
    expect(sameWindow({ id: 4, app: "Chrome", title: "Slides" }, { id: "4", app: "Chrome", title: "" })).toBe(true);
  });

  it("recognises a titled window again by application and title once its handle changed", () => {
    expect(sameWindow({ id: 4, app: "Chrome", title: "Slides" }, { id: 9, app: "Chrome", title: "Slides" })).toBe(true);
  });

  it("never treats two untitled windows of one app as the same window", () => {
    expect(sameWindow({ id: 1, app: "Google Chrome", title: "" }, { id: 2, app: "Google Chrome", title: "" })).toBe(false);
  });

  it("treats a blank or missing title as no title", () => {
    expect(sameWindow({ id: 1, app: "Notes", title: "  " }, { id: 2, app: "Notes", title: "  " })).toBe(false);
    expect(sameWindow({ id: 1, app: "Notes" }, { id: 2, app: "Notes" })).toBe(false);
  });

  it("does not match the same title in another app", () => {
    expect(sameWindow({ id: 1, app: "Notes", title: "Untitled" }, { id: 2, app: "TextEdit", title: "Untitled" })).toBe(false);
  });

  it("does not match on missing handles or missing windows", () => {
    expect(sameWindow({ app: "Notes", title: "" }, { app: "Notes", title: "" })).toBe(false);
    expect(sameWindow(null, { id: 1 })).toBe(false);
    expect(sameWindow({ id: 1 }, undefined)).toBe(false);
  });
});

// Two Chrome windows on a Mac without the Screen Recording permission: both
// are listed as just "Google Chrome", with no title. main.js ticks, unticks
// and re-finds shared windows with sameWindow exactly as below.
describe("sharing untitled windows of the same app", () => {
  const first = { id: 1, app: "Google Chrome", title: "" };
  const second = { id: 2, app: "Google Chrome", title: "" };
  const untick = (shared, win) => shared.filter((entry) => !sameWindow(entry, win));
  const tick = (shared, win) => [...untick(shared, win), win];

  it("ticking the second keeps the first ticked", () => {
    const shared = tick([first], second);
    expect(shared).toEqual([first, second]);
    expect(matchesSharedWindow(first, shared)).toBe(true);
    expect(matchesSharedWindow(second, shared)).toBe(true);
  });

  it("unticking one leaves the other shared", () => {
    expect(untick([first, second], first)).toEqual([second]);
    expect(untick([first, second], second)).toEqual([first]);
  });

  it("sharing one does not share the other", () => {
    expect(matchesSharedWindow(second, [first])).toBe(false);
  });

  it("does not move a closed untitled window's handle onto another untitled window", () => {
    const open = [{ id: 7, app: "Google Chrome", title: "" }];
    expect(open.find((win) => sameWindow(first, win))).toBeUndefined();
    const titled = [{ id: 8, app: "Google Chrome", title: "Lesson slides" }];
    expect(titled.find((win) => sameWindow({ id: 3, app: "Google Chrome", title: "Lesson slides" }, win))).toBe(titled[0]);
  });
});

describe("pickerLabels", () => {
  const chrome = (id, x, y = 0, width = 1280, height = 800) => ({ id, app: "Google Chrome", title: "", x, y, width, height });

  it("tells identical untitled windows apart by number, size and place", () => {
    expect(pickerLabels([chrome(1, 0), chrome(2, 1300)])).toEqual([
      { name: "Google Chrome", meta: "Window 1 of 2 · 1280×800, left" },
      { name: "Google Chrome", meta: "Window 2 of 2 · 1280×800, right" },
    ]);
  });

  it("numbers by where the windows are, not the order they were listed in", () => {
    expect(pickerLabels([chrome(2, 1300), chrome(1, 0)]).map((label) => label.meta)).toEqual([
      "Window 2 of 2 · 1280×800, right",
      "Window 1 of 2 · 1280×800, left",
    ]);
  });

  it("names windows stacked above each other, or arranged in a grid", () => {
    expect(pickerLabels([chrome(1, 0, 0, 1280, 400), chrome(2, 0, 450, 1280, 400)]).map((label) => label.meta)).toEqual([
      "Window 1 of 2 · 1280×400, top",
      "Window 2 of 2 · 1280×400, bottom",
    ]);
    expect(pickerLabels([chrome(1, 0, 0), chrome(2, 1300, 900)]).map((label) => label.meta)).toEqual([
      "Window 1 of 2 · 1280×800, top left",
      "Window 2 of 2 · 1280×800, bottom right",
    ]);
  });

  it("falls back to size alone for windows in the same place", () => {
    expect(pickerLabels([chrome(1, 100, 100, 800, 600), chrome(2, 110, 110, 780, 580)]).map((label) => label.meta)).toEqual([
      "Window 1 of 2 · 800×600",
      "Window 2 of 2 · 780×580",
    ]);
  });

  it("keeps the plain labels of windows that are already distinct", () => {
    expect(pickerLabels([
      { id: 1, app: "Google Chrome", title: "Lesson slides", x: 0, y: 0, width: 800, height: 600 },
      { id: 2, app: "Notes", title: "", x: 0, y: 0, width: 800, height: 600 },
      { id: 3, app: "TextEdit", title: "Untitled", x: 0, y: 0, width: 800, height: 600 },
      { id: 4, app: "Preview", title: "Untitled", x: 0, y: 0, width: 800, height: 600 },
      { id: 5, app: "", title: "", x: 0, y: 0, width: 800, height: 600 },
    ])).toEqual([
      { name: "Lesson slides", meta: "Google Chrome" },
      { name: "Notes", meta: "" },
      { name: "Untitled", meta: "TextEdit" },
      { name: "Untitled", meta: "Preview" },
      { name: "Untitled window", meta: "" },
    ]);
  });

  it("numbers titled windows that share a title in the same app, after the app name", () => {
    const tab = (id, x) => ({ id, app: "Google Chrome", title: "New Tab", x, y: 0, width: 1280, height: 800 });
    expect(pickerLabels([tab(1, 0), tab(2, 1300)])).toEqual([
      { name: "New Tab", meta: "Google Chrome · window 1 of 2 · 1280×800, left" },
      { name: "New Tab", meta: "Google Chrome · window 2 of 2 · 1280×800, right" },
    ]);
  });

  it("names the middle of three windows in a row", () => {
    expect(pickerLabels([chrome(1, 0), chrome(2, 700), chrome(3, 1400)]).map((label) => label.meta)).toEqual([
      "Window 1 of 3 · 1280×800, left",
      "Window 2 of 3 · 1280×800, middle",
      "Window 3 of 3 · 1280×800, right",
    ]);
  });

  it("copes with an empty or missing list", () => {
    expect(pickerLabels([])).toEqual([]);
    expect(pickerLabels(undefined)).toEqual([]);
  });
});

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
