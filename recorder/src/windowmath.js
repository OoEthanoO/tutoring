// Pure rules behind "record only the windows I choose".
//
// Kept out of main.js and free of any app state so they can be unit tested:
// getting the crop maths wrong is invisible until a class is recorded, and the
// recorder has no other way to check itself.
//
// Loaded as a plain script before main.js (it defines a global) and imported
// directly by windowmath.test.js.

(function (root) {
  "use strict";

  /**
   * Is this window one the tutor agreed to share?
   *
   * Matched by handle first. Handles do not survive closing a window or
   * restarting the recorder, so a window with the same application *and* the
   * same title as one that was picked also counts — an untitled window never
   * does, or every untitled window of that app would match.
   */
  const matchesSharedWindow = (win, shared) => {
    if (!win || win.own || !Array.isArray(shared)) {
      return false;
    }
    return shared.some(
      (entry) =>
        Boolean(entry) &&
        (String(entry.id) === String(win.id) ||
          (Boolean(entry.app) &&
            Boolean(entry.title) &&
            entry.app === win.app &&
            entry.title === win.title))
    );
  };

  /**
   * The window's rectangle in the recorded display's capture pixels, or null
   * when there is not enough of it on that display to be worth recording.
   *
   * macOS reports window bounds in points while the capture is in pixels, which
   * `win.scaled` marks; Windows already reports physical pixels. Display
   * position and size are physical pixels on both.
   */
  const cropWindowToDisplay = (win, display, minSide) => {
    if (!win || !display) {
      return null;
    }
    const scale = win.scaled ? display.scaleFactor || 1 : 1;
    const left = Math.round(win.x * scale) - display.x;
    const top = Math.round(win.y * scale) - display.y;
    const x0 = Math.max(0, left);
    const y0 = Math.max(0, top);
    const x1 = Math.min(display.width, left + Math.round(win.width * scale));
    const y1 = Math.min(display.height, top + Math.round(win.height * scale));
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < minSide || height < minSide) {
      return null;
    }
    // h.264 wants even dimensions.
    return { x: x0, y: y0, width: width - (width % 2), height: height - (height % 2) };
  };

  /**
   * Is the segment already running still the right one?
   *
   * Small geometry drift is ignored, and a window that has just been moved is
   * left alone for `settleMs`, so dragging one does not restart ffmpeg several
   * times a second.
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
    if (desired.kind !== "window") {
      return true;
    }
    if (String(desired.id) !== String(active.id)) {
      return false;
    }
    if (!desired.crop || !active.crop) {
      return false;
    }
    const drift = Math.max(
      Math.abs(desired.crop.x - active.crop.x),
      Math.abs(desired.crop.y - active.crop.y),
      Math.abs(desired.crop.width - active.crop.width),
      Math.abs(desired.crop.height - active.crop.height)
    );
    if (drift <= driftTolerance) {
      return true;
    }
    return now - lastChangeMs < settleMs;
  };

  const api = { matchesSharedWindow, cropWindowToDisplay, targetsMatch };
  root.RecorderWindowMath = api;
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
