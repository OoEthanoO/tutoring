(function (root) {
  "use strict";

  const beforeEnd = (session, nowMs) => session && !session.test &&
    Number.isFinite(session.endsAtMs) && Number.isFinite(nowMs) && nowMs < session.endsAtMs;

  const retainSession = (session, active, nowMs) => Boolean(
    beforeEnd(session, nowMs) && !session.finalizing && (!active || active.classId !== session.classId)
  );

  const canFinalizeRemovedChannel = (session, nowMs) => Boolean(
    session?.mustFinalize && session.phase === "after_end" &&
    Number.isFinite(session.endsAtMs) && nowMs >= session.endsAtMs
  );

  /** Preserve the in-flight segment too, including after an interrupted shutdown. */
  const recoverSegments = async (meta, fileSize) => {
    const segments = [];
    const paths = new Set();
    for (const segment of [...(meta?.segments || []), ...(meta?.currentSegment ? [meta.currentSegment] : [])]) {
      if (!segment.path || paths.has(segment.path)) continue;
      paths.add(segment.path);
      try {
        const sizeBytes = await fileSize(segment.path);
        if (sizeBytes > 0) segments.push({ ...segment, sizeBytes });
      } catch {
        // A missing/empty file is not a recoverable segment.
      }
    }
    return segments;
  };

  const nextSegmentNumber = (segments) => 1 + Math.max(0, ...segments.map((segment) =>
    Number(String(segment.path).match(/seg-(\d+)\.mp4$/)?.[1] || 0)
  ));

  const api = { retainSession, canFinalizeRemovedChannel, recoverSegments, nextSegmentNumber };
  root.RecorderSessionPolicy = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
