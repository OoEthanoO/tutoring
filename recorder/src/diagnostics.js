(function (root) {
  "use strict";

  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_LOGS = 100;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STATES = new Set(["idle", "pre_arm", "armed", "recording", "paused", "paused_manual", "paused_forced",
    "finalizing", "uploading", "capture_failed", "preparation_failed", "upload_failed", "waiting_for_devices",
    "waiting_for_voice", "reconnecting", "starting"]);

  // This same allowlist/redactor runs in the app BEFORE transmission and again
  // on the server. Never serialize settings, native device objects or exercises.
  const redact = (value, privateValues = []) => {
    let text = typeof value === "string" ? value : "";
    for (const secret of privateValues.filter((v) => typeof v === "string" && v.length > 0).sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join("[private]");
    }
    // Bound work as well as output: a directly submitted single huge log line
    // must not make regex scanning stall the diagnostics endpoint.
    const clean = text.slice(0, 4096)
      .replace(/https?:\/\/[^\s<>"']+/gi, "[url]")
      .replace(/\b(?:Bearer|Bot)\s+[^\s,"'}]+/gi, "[authorization]")
      .replace(/\b(?:password|token|secret|api[_-]?key|authorization)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "[credential]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[credential]")
      .replace(/[A-Z0-9._%+-]{1,128}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/gi, "[email]")
      .replace(/(?:[A-Z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|private|Applications|Volumes|Library)\/)[^\r\n|<>"':]*/gi, "[path]")
      .replace(/[A-Za-z0-9_+\/-]{32,}(?:\.[A-Za-z0-9_+\/-]+)*/g, "[identifier]")
      .replace(/[\u0000-\u001f\u007f]/g, " ");
    return clean.length > 400 ? clean.slice(0, 220) + " … " + clean.slice(-177) : clean;
  };
  const count = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1000000, Math.floor(value))) : 0;
  const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const normalize = (input, nowMs = Date.now()) => {
    if (!input || typeof input !== "object" || input.schema !== 1 || !STATES.has(input.state)) return null;
    return {
      schema: 1,
      state: input.state,
      classId: typeof input.classId === "string" && UUID.test(input.classId) ? input.classId : null,
      phase: ["pre_arm", "armed", "live", "after_end"].includes(input.phase) ? input.phase : null,
      lastSuccessfulTickAt: timestamp(input.lastSuccessfulTickAt),
      inCall: typeof input.inCall === "boolean" ? input.inCall : null,
      capturing: input.capturing === true,
      muted: input.muted === true,
      frozen: input.frozen === true,
      captureMode: input.captureMode === "windows" ? "windows" : "display",
      captureFailures: count(input.captureFailures),
      segmentCount: count(input.segmentCount),
      pendingUploads: count(input.pendingUploads),
      logs: (Array.isArray(input.logs) ? input.logs : []).slice(-MAX_LOGS).flatMap((entry) => {
        const at = timestamp(entry?.at);
        if (!at || Date.parse(at) < nowMs - RETENTION_MS) return [];
        const message = redact(entry.message);
        return message ? [{ at, message }] : [];
      }),
    };
  };

  const recorderState = (context) => {
    const session = context.session;
    if (session?.test) return "test";
    if (session?.finalizing || context.preparing) return "finalizing";
    if (!session) {
      if (context.uploading) return "uploading";
      return context.uploadFailed ? "upload_failed" : "idle";
    }
    if (session.capturing) return "recording";
    if (session.finalizeReason) return "preparation_failed";
    if (session.phase === "pre_arm" || session.phase === "armed") return session.phase;
    if (session.captureDisabled) return "capture_failed";
    if (session.pauseMode === "manual" || session.pauseMode === "forced") return `paused_${session.pauseMode}`;
    if (!context.ready) return "waiting_for_devices";
    if (!context.online) return "reconnecting";
    if (!session.inCall) return "waiting_for_voice";
    return "starting";
  };

  /** A separate, bounded reporter. No native calls or recording-loop awaits. */
  const createReporter = ({ context, send, now = Date.now }) => {
    let owner = null;
    let logs = [];
    let busy = false;
    let lastAttempt = -Infinity;
    const current = () => {
      const value = context();
      const nextOwner = value.userId || null;
      if (owner !== nextOwner) { owner = nextOwner; logs = []; lastAttempt = -Infinity; }
      return value;
    };
    const record = (message) => {
      try {
        const value = current();
        if (!owner || value.test) return;
        logs.push({ at: new Date(now()).toISOString(), message: redact(message, value.privateValues) });
        logs = logs.slice(-MAX_LOGS);
      } catch { /* Even malformed diagnostic context must not break log(). */ }
    };
    const flush = async () => {
      try {
        const value = current();
        if (!owner || !value.signedIn || value.test || busy || now() - lastAttempt < 30000) return;
        const report = normalize({ ...value.report, schema: 1, logs }, now());
        if (!report) return;
        busy = true;
        lastAttempt = now();
        try { await send(value.deviceId, report); }
        finally { busy = false; }
      } catch { /* Diagnostics must never affect recording. */ }
    };
    return { record, flush };
  };

  const api = { redact, normalize, recorderState, createReporter, RETENTION_MS, MAX_LOGS };
  root.RecorderDiagnostics = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
