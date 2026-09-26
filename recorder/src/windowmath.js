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

  const api = { matchesSharedWindow, targetsMatch };
  root.RecorderWindowMath = api;
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
