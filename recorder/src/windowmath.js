// Pure rules behind "record only the windows I choose".
//
// Kept out of main.js and free of any app state so they can be unit tested:
// getting these rules wrong is invisible until a class is recorded, and the
// recorder has no other way to check itself.
//
// Loaded as a plain script before main.js (it defines a global) and imported
// directly by windowmath.test.js.

(function (root) {
  "use strict";

  /** A title that can identify or label a window: not missing or blank. */
  const hasTitle = (win) => typeof win?.title === "string" && win.title.trim() !== "";

  /**
   * Do these two describe the same window?
   *
   * The same handle always does. Handles do not survive closing a window or
   * restarting the recorder, so the same application *and* the same title
   * also counts — but only for a window that has a title. macOS reports no
   * titles at all without the Screen Recording permission, and two untitled
   * windows of one app are not the same window: matching them would share,
   * tick or untick every untitled window of that app at once.
   *
   * The one rule for matching a shared window, ticking and unticking one in
   * the picker, and finding a shared window again after its handle changed.
   */
  const sameWindow = (a, b) => {
    if (!a || !b) {
      return false;
    }
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) {
      return true;
    }
    return Boolean(a.app) && hasTitle(a) && a.app === b.app && a.title === b.title;
  };

  /** Is this window one the tutor agreed to share? */
  const matchesSharedWindow = (win, shared) => {
    if (!win || win.own || !Array.isArray(shared)) {
      return false;
    }
    return shared.some((entry) => sameWindow(entry, win));
  };

  // Windows whose centres are closer than this (in the platform's window
  // units) count as being in the same place.
  const SAME_PLACE = 40;

  /** The third of [min, max] a value falls in, as one of three words. */
  const band = (value, min, max, words) => {
    if (max - min < SAME_PLACE) {
      return "";
    }
    const share = (value - min) / (max - min);
    return share < 1 / 3 ? words[0] : share > 2 / 3 ? words[2] : words[1];
  };

  const placeName = (vertical, horizontal) => {
    if (vertical === "middle" && horizontal === "middle") {
      return "centre";
    }
    const parts = [vertical, horizontal].filter((word) => word && word !== "middle");
    return parts.length > 0 ? parts.join(" ") : vertical || horizontal;
  };

  /**
   * What the window picker shows for each window, in the same order: a name
   * (the title, or the application when there is none) and a line under it.
   *
   * Windows that would otherwise look identical — two untitled "Google
   * Chrome" windows, which is all macOS shows without the Screen Recording
   * permission — are numbered left to right and told apart by size and
   * place: "Window 2 of 2 · 1280×800, right".
   */
  const pickerLabels = (windows) => {
    const list = (Array.isArray(windows) ? windows : []).map((win) => win || {});
    const labels = list.map((win) => {
      const app = String(win.app || "").trim();
      return hasTitle(win)
        ? { name: win.title.trim(), meta: app, key: `${win.title.trim()}\u0000${app}` }
        : { name: app || "Untitled window", meta: "", key: `\u0000${app}` };
    });
    const groups = new Map();
    labels.forEach((label, index) => groups.set(label.key, [...(groups.get(label.key) || []), index]));
    const centre = (win) => ({
      x: (Number(win.x) || 0) + (Number(win.width) || 0) / 2,
      y: (Number(win.y) || 0) + (Number(win.height) || 0) / 2,
    });
    for (const indexes of groups.values()) {
      if (indexes.length < 2) {
        continue;
      }
      const ordered = [...indexes].sort((a, b) => {
        const first = centre(list[a]);
        const second = centre(list[b]);
        return first.x - second.x || first.y - second.y || a - b;
      });
      const xs = ordered.map((index) => centre(list[index]).x);
      const ys = ordered.map((index) => centre(list[index]).y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      ordered.forEach((index, position) => {
        const win = list[index];
        const middle = centre(win);
        const place = placeName(
          band(middle.y, minY, maxY, ["top", "middle", "bottom"]),
          band(middle.x, minX, maxX, ["left", "middle", "right"])
        );
        const size = `${Math.round(Number(win.width) || 0)}×${Math.round(Number(win.height) || 0)}`;
        const line = [labels[index].meta, `window ${position + 1} of ${ordered.length}`, place ? `${size}, ${place}` : size]
          .filter(Boolean)
          .join(" · ");
        labels[index].meta = line.charAt(0).toUpperCase() + line.slice(1);
      });
    }
    return labels.map(({ name, meta }) => ({ name, meta }));
  };

  /**
   * Is the segment already running still the right one?
   *
   * A window is captured on its own — its pixels, not a rectangle of the
   * screen — so the capture follows it when it moves and nothing drawn over it
   * (a notification, another window) is ever recorded. Moving a window
   * therefore needs no new segment. Resizing does: the picture was fitted to
   * the window's shape when the segment started. Small size drift is ignored,
   * and a window being resized is left alone for `settleMs`, so dragging its
   * edge does not restart ffmpeg several times a second.
   */
  const targetsMatch = (desired, active, options) => {
    const settings = options || {};
    const driftTolerance = settings.driftTolerance ?? 3;
    const settleMs = settings.settleMs ?? 0;
    const lastChangeMs = settings.lastChangeMs ?? 0;
    const now = settings.now ?? Date.now();

    if (!desired || !active) {
      return !desired && !active;
    }
    if (desired.kind !== active.kind) {
      return false;
    }
    // Muting drops the microphone from the recording, which means a new
    // segment whatever is being captured.
    if (Boolean(desired.muted) !== Boolean(active.muted)) {
      return false;
    }
    if (desired.kind !== "window") {
      return true;
    }
    if (String(desired.id) !== String(active.id)) {
      return false;
    }
    if (!desired.size || !active.size) {
      return false;
    }
    const drift = Math.max(
      Math.abs(desired.size.width - active.size.width),
      Math.abs(desired.size.height - active.size.height)
    );
    if (drift <= driftTolerance) {
      return true;
    }
    return now - lastChangeMs < settleMs;
  };

  const api = { sameWindow, matchesSharedWindow, pickerLabels, targetsMatch };
  root.RecorderWindowMath = api;
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
