// YanLearn Recorder — UI and recording state machine.
//
// The server (/api/recorder/tick) is the source of truth for time, which class
// the recorder is responsible for, what phase it is in, whether the tutor is in
// the live voice channel, and whether that channel has been torn down. This
// file turns those facts plus the tutor's own actions (pause hotkey, "class
// done" answer, device choices) into ffmpeg segments, and uploads the result.
//
// Phases (see src/lib/recorderPolicy.ts on the server):
//   pre_arm  15–5 min before start: get ready, may still quit
//   armed    <5 min before start:   quit locked, not recording yet
//   live     start..end:            recording while in the call and not paused
//   after_end                       past the end; ask "class done?" when out of the call
//
// Pause modes:
//   none    recording follows the tutor's presence in the call
//   manual  the tutor paused while in the call (large reminder overlay)
//   forced  the tutor paused while outside the call: joining does NOT resume
//   (leaving the call always pauses; that is not a mode, just !inCall)

(function () {
  "use strict";

  const tauri = window.__TAURI__;
  const invoke = tauri.core.invoke;
  const listen = tauri.event.listen;

  const DEFAULT_SERVER = "https://learn.ethanyanxu.com";
  const DEFAULT_HOTKEY = "CmdOrCtrl+Alt+P";
  const IDLE_POLL_MS = 30000;
  const ACTIVE_POLL_MS = 2000;
  const CRASH_FALLBACK_SECONDS = 4;
  const MAX_CAPTURE_FAILURES = 6;
  const RECORDING_FPS = 10;
  const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  // Never restart for an update this close to the next class.
  const UPDATE_QUIET_WINDOW_MS = 20 * 60 * 1000;

  const state = {
    info: null,
    settings: null,
    probe: null,
    displays: [],
    tick: null,
    clockOffsetMs: 0,
    online: false,
    session: null,
    uploads: [],
    pendingFinished: null,
    recordingsDir: "",
    timer: null,
    tickBusy: false,
    evaluating: false,
    reevaluate: false,
    deviceChoiceNeeded: false,
    devicePromptShownForClass: null,
    uploadProgress: null,
    quitLocked: false,
    lastOverlayJson: "",
    recovered: false,
    hotkeyLabel: "Ctrl+Alt+P",
    update: {
      info: null,
      lastCheckAt: 0,
      checking: false,
      downloading: false,
      progress: null,
      ready: false,
      installing: false,
    },
    logLines: [],
  };

  const $ = (id) => document.getElementById(id);

  // --- Utilities ---------------------------------------------------------------

  const serverNow = () => Date.now() + state.clockOffsetMs;

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString();
    state.logLines.push(`[${stamp}] ${message}`);
    while (state.logLines.length > 200) {
      state.logLines.shift();
    }
    const el = $("log");
    if (el) {
      el.textContent = state.logLines.join("\n");
      el.scrollTop = el.scrollHeight;
    }
    console.log(message);
  };

  const formatClock = (ms) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const formatCountdown = (untilMs) => {
    const total = Math.max(0, Math.ceil((untilMs - serverNow()) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const formatElapsed = (sinceMs) => {
    const total = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mmss = `${hours > 0 ? String(minutes).padStart(2, "0") : minutes}:${String(seconds).padStart(2, "0")}`;
    return hours > 0 ? `${hours}:${mmss}` : mmss;
  };

  const readJson = async (path) => {
    try {
      const text = await invoke("read_text_file", { path });
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };

  const writeJson = (path, value) =>
    invoke("write_text_file", { path, contents: JSON.stringify(value, null, 2) });

  const saveSettings = () => invoke("save_settings", { settings: state.settings });

  const api = async (path, { method = "GET", body, auth = true } = {}) => {
    const headers = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (auth && state.settings.token) {
      headers.Authorization = `Bearer ${state.settings.token}`;
    }
    const response = await fetch(`${state.settings.serverUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  };

  // --- Settings ----------------------------------------------------------------

  const defaultSettings = () => ({
    serverUrl: DEFAULT_SERVER,
    token: null,
    user: null,
    deviceId: crypto.randomUUID(),
    hotkey: DEFAULT_HOTKEY,
    display: null,
    microphoneId: null,
    microphoneName: null,
    outputId: null,
    outputName: null,
    systemAudio: true,
    hardwareEncoding: true,
    captureBackend: null,
    encoder: null,
    pendingUpdate: null,
  });

  const loadSettings = async () => {
    const stored = await invoke("load_settings");
    const settings = Object.assign(defaultSettings(), stored && typeof stored === "object" ? stored : {});
    if (!settings.deviceId) {
      settings.deviceId = crypto.randomUUID();
    }
    settings.serverUrl = String(settings.serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
    state.settings = settings;
    await saveSettings();
  };

  // --- Devices -----------------------------------------------------------------

  const refreshDevices = async () => {
    try {
      state.displays = await invoke("list_displays");
    } catch (error) {
      state.displays = [];
      log(`Could not list displays: ${error}`);
    }
    try {
      state.probe = await invoke("probe_capture");
      for (const warning of state.probe.warnings || []) {
        log(warning);
      }
    } catch (error) {
      state.probe = null;
      log(`Could not probe capture devices: ${error}`);
    }
    autoSelectDevices();
    await saveSettings();
    renderDevices();
  };

  const displayMatches = (choice, display) =>
    Boolean(choice) &&
    choice.width === display.width &&
    choice.height === display.height &&
    (choice.name === display.name || choice.index === display.index);

  const chosenDisplay = () => {
    const choice = state.settings.display;
    if (!choice) {
      return null;
    }
    return (
      state.displays.find((display) => display.index === choice.index && displayMatches(choice, display)) ||
      state.displays.find((display) => displayMatches(choice, display)) ||
      null
    );
  };

  const chosenMicrophone = () => {
    const mics = state.probe?.microphones || [];
    return mics.find((mic) => mic.id === state.settings.microphoneId) || null;
  };

  const chosenOutput = () => {
    const outputs = state.probe?.outputs || [];
    return outputs.find((output) => output.id === state.settings.outputId) || null;
  };

  const autoSelectDevices = () => {
    const settings = state.settings;
    if (state.displays.length === 1) {
      settings.display = pickDisplay(state.displays[0]);
    } else if (state.displays.length > 1 && !chosenDisplay()) {
      settings.display = null;
    }
    const mics = state.probe?.microphones || [];
    if (mics.length === 1) {
      settings.microphoneId = mics[0].id;
      settings.microphoneName = mics[0].name;
    } else if (mics.length === 0) {
      settings.microphoneId = null;
      settings.microphoneName = null;
    } else if (!chosenMicrophone()) {
      settings.microphoneId = null;
      settings.microphoneName = null;
    }
    const outputs = state.probe?.outputs || [];
    if (outputs.length === 1) {
      settings.outputId = outputs[0].id;
      settings.outputName = outputs[0].name;
    } else if (outputs.length === 0) {
      settings.outputId = null;
      settings.outputName = null;
    } else if (!chosenOutput()) {
      settings.outputId = null;
      settings.outputName = null;
    }
  };

  const pickDisplay = (display) => ({
    index: display.index,
    name: display.name,
    width: display.width,
    height: display.height,
  });

  /** macOS: the avfoundation "Capture screen N" device for a display. */
  const screenDeviceIndex = (display) => {
    const screens = state.probe?.screens || [];
    if (screens.length === 0) {
      return null;
    }
    const exact = screens.find((screen) => screen.name === `Capture screen ${display.index}`);
    if (exact) {
      return exact.index;
    }
    const first = screens.find((screen) => /capture screen/i.test(screen.name));
    return first ? first.index : null;
  };

  const deviceProblems = () => {
    const problems = [];
    if (!state.probe || !state.probe.ffmpegOk) {
      problems.push("The recording engine (ffmpeg) is missing. Reinstall YanLearn Recorder.");
      return problems;
    }
    if (state.displays.length === 0) {
      problems.push("No display was found.");
    } else if (state.displays.length > 1 && !chosenDisplay()) {
      problems.push("Choose which display to record.");
    }
    const mics = state.probe.microphones || [];
    if (mics.length > 1 && !chosenMicrophone()) {
      problems.push("Choose which microphone to record.");
    }
    const outputs = state.probe.outputs || [];
    if (state.settings.systemAudio && outputs.length > 1 && !chosenOutput()) {
      problems.push("Choose which speaker's audio to record.");
    }
    if (state.info?.platform === "macos" && chosenDisplay() && screenDeviceIndex(chosenDisplay()) === null) {
      problems.push("Screen capture device not found. Allow Screen Recording for YanLearn Recorder in System Settings, then refresh.");
    }
    return problems;
  };

  const devicesReady = () => deviceProblems().length === 0;

  // --- Sessions ----------------------------------------------------------------

  const sessionDir = (classId) => `${state.recordingsDir}/${classId}`;

  const persistMeta = async () => {
    const session = state.session;
    if (!session) {
      return;
    }
    await writeJson(`${session.dir}/meta.json`, {
      classId: session.classId,
      courseTitle: session.courseTitle,
      classTitle: session.classTitle,
      startsAtMs: session.startsAtMs,
      endsAtMs: session.endsAtMs,
      segments: session.segments,
    });
  };

  const createSession = async (active) => {
    const dir = sessionDir(active.classId);
    await invoke("ensure_dir", { path: dir });
    const meta = await readJson(`${dir}/meta.json`);
    const segments = [];
    for (const segment of meta?.segments || []) {
      try {
        const size = await invoke("file_size", { path: segment.path });
        if (size > 0) {
          segments.push({ ...segment, sizeBytes: size });
        }
      } catch {
        // The file is gone; skip it.
      }
    }
    state.session = {
      classId: active.classId,
      dir,
      courseTitle: active.courseTitle,
      classTitle: active.classTitle,
      startsAtMs: active.startsAtMs,
      endsAtMs: active.endsAtMs,
      phase: active.phase,
      mustFinalize: false,
      liveChannel: active.liveChannel,
      presenceReason: null,
      inCall: false,
      pauseMode: "none",
      capturing: false,
      currentSegment: null,
      segments,
      recordingStartedAtMs: segments.length > 0 ? segments[0].startedAtMs : null,
      prompted: false,
      promptOpen: false,
      finalizing: false,
      captureFailures: 0,
      captureDisabled: false,
      nextCaptureAttemptMs: 0,
      systemAudioActive: false,
      currentEncoder: null,
      currentBackend: null,
    };
    state.devicePromptShownForClass = null;
    if (segments.length > 0) {
      log(`Resumed ${segments.length} recorded segment(s) for ${active.courseTitle}.`);
    }
    log(`Class scheduled: ${active.courseTitle} — ${active.classTitle} (${formatClock(active.startsAtMs)}–${formatClock(active.endsAtMs)}).`);
  };

  const clearSession = () => {
    state.session = null;
    closeDonePrompt();
  };

  // --- Capture -----------------------------------------------------------------

  const chosenEncoder = () => {
    if (state.settings.encoder) {
      return state.settings.encoder;
    }
    const encoders = state.probe?.encoders || [];
    if (state.settings.hardwareEncoding !== false && encoders.length > 0) {
      return encoders[0];
    }
    return "libx264";
  };

  const startSegment = async () => {
    const session = state.session;
    const display = chosenDisplay();
    if (!session || !display) {
      return;
    }
    if (Date.now() < session.nextCaptureAttemptMs) {
      return;
    }
    const index = session.segments.length + 1;
    const path = `${session.dir}/seg-${String(index).padStart(3, "0")}.mp4`;
    const config = {
      outputPath: path,
      displayX: display.x,
      displayY: display.y,
      displayWidth: display.width,
      displayHeight: display.height,
      singleDisplay: state.displays.length <= 1,
      screenDeviceIndex: screenDeviceIndex(display),
      microphoneId: chosenMicrophone()?.id ?? null,
      outputDeviceId: chosenOutput()?.id ?? null,
      systemAudio: state.settings.systemAudio !== false && state.probe?.systemAudio !== "none",
      backend: state.settings.captureBackend || null,
      encoder: chosenEncoder(),
      fps: RECORDING_FPS,
    };
    try {
      const started = await invoke("start_capture", { config });
      session.capturing = true;
      session.currentSegment = { path, startedAtMs: serverNow() };
      session.currentEncoder = started.encoder;
      session.currentBackend = started.backend;
      session.systemAudioActive = started.systemAudio;
      if (!session.recordingStartedAtMs) {
        session.recordingStartedAtMs = serverNow();
      }
      for (const warning of started.warnings || []) {
        log(warning);
      }
      log(`Recording started (${started.backend}, ${started.encoder}${started.systemAudio ? ", system audio" : ""}).`);
      await persistMeta();
    } catch (error) {
      session.captureFailures += 1;
      session.nextCaptureAttemptMs = Date.now() + 3000;
      log(`Could not start recording: ${error}`);
      if (session.captureFailures >= MAX_CAPTURE_FAILURES) {
        session.captureDisabled = true;
        log("Recording has failed repeatedly and has been stopped for this class. Tell a founder.");
      }
    }
  };

  const stopSegment = async () => {
    const session = state.session;
    if (!session) {
      return;
    }
    let stopped = { sizeBytes: 0, seconds: 0 };
    try {
      stopped = await invoke("stop_capture");
    } catch (error) {
      log(`Could not stop recording cleanly: ${error}`);
    }
    session.capturing = false;
    if (session.currentSegment) {
      const segment = { ...session.currentSegment, endedAtMs: serverNow(), sizeBytes: stopped.sizeBytes || 0 };
      if (segment.sizeBytes > 0) {
        session.segments.push(segment);
      }
      session.currentSegment = null;
    }
    log(`Recording paused/stopped (${Math.round(stopped.seconds || 0)} s).`);
    await persistMeta();
  };

  /** ffmpeg exited on its own: keep what it wrote, then work out why. */
  const handleCaptureExit = async (status) => {
    const session = state.session;
    if (!session) {
      return;
    }
    const seconds = status.seconds || 0;
    const tail = (status.stderrTail || []).slice(-6).join(" | ");
    await stopSegment();
    if (seconds < CRASH_FALLBACK_SECONDS) {
      if (session.currentEncoder && session.currentEncoder !== "libx264") {
        state.settings.encoder = "libx264";
        log(`The ${session.currentEncoder} encoder failed; switching to the software encoder. ${tail}`);
      } else if (state.info?.platform === "windows" && session.currentBackend === "ddagrab") {
        state.settings.captureBackend = "gdigrab";
        log(`Desktop Duplication capture failed; switching to GDI capture. ${tail}`);
      } else {
        session.captureFailures += 1;
        log(`Recording failed to start: ${tail || `exit code ${status.exitCode}`}`);
        if (session.captureFailures >= MAX_CAPTURE_FAILURES) {
          session.captureDisabled = true;
          log("Recording has failed repeatedly and has been stopped for this class. Tell a founder.");
        }
      }
      await saveSettings();
      session.nextCaptureAttemptMs = Date.now() + 2000;
    } else {
      log(`The recording process ended unexpectedly after ${Math.round(seconds)} s; restarting. ${tail}`);
      session.nextCaptureAttemptMs = Date.now() + 1000;
    }
  };

  // --- Finalize + upload ---------------------------------------------------------

  const finalizeSegments = async ({ classId, dir, segments, courseTitle }, reason) => {
    const usable = segments.filter((segment) => segment.sizeBytes > 0);
    if (usable.length === 0) {
      log(`Nothing was recorded for ${courseTitle || classId}.`);
      state.pendingFinished = { classId, reason: "no_recording" };
      await invoke("remove_path", { path: dir });
      return;
    }
    const outputPath = `${dir}/recording.mp4`;
    let sizeBytes = 0;
    let uploadPath = outputPath;
    try {
      sizeBytes = await invoke("concat_segments", { segments: usable.map((segment) => segment.path), output: outputPath });
    } catch (error) {
      // Fall back to the largest playable segment rather than losing the class.
      const largest = usable.reduce((best, segment) => (segment.sizeBytes > best.sizeBytes ? segment : best), usable[0]);
      uploadPath = largest.path;
      sizeBytes = largest.sizeBytes;
      log(`Could not combine the segments (${error}); uploading the largest one instead.`);
    }
    const durationSeconds = Math.round(
      usable.reduce((sum, segment) => sum + Math.max(0, ((segment.endedAtMs || segment.startedAtMs) - segment.startedAtMs) / 1000), 0)
    );
    const upload = {
      classId,
      dir,
      courseTitle: courseTitle || "",
      outputPath: uploadPath,
      sizeBytes,
      startedAtMs: usable[0].startedAtMs,
      endedAtMs: usable[usable.length - 1].endedAtMs || usable[usable.length - 1].startedAtMs,
      durationSeconds,
      reason,
      attempts: 0,
      nextAttemptMs: 0,
      recordingId: null,
      uploadUrl: null,
      uploading: false,
    };
    await writeJson(`${dir}/pending.json`, upload);
    state.uploads.push(upload);
    log(`Recording ready to upload (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB, ${Math.round(durationSeconds / 60)} min).`);
  };

  const finalize = async (reason) => {
    const session = state.session;
    if (!session || session.finalizing) {
      return;
    }
    session.finalizing = true;
    closeDonePrompt();
    render();
    await updateOverlay();
    if (session.capturing) {
      await stopSegment();
    }
    log(`Finishing the class (${reason.replace(/_/g, " ")}).`);
    await finalizeSegments(session, reason);
    clearSession();
    await processUploads();
    scheduleTick(500);
  };

  const persistUpload = (upload) => writeJson(`${upload.dir}/pending.json`, upload);

  const attemptUpload = async (upload) => {
    if (upload.uploading) {
      return;
    }
    upload.uploading = true;
    upload.attempts += 1;
    render();
    await updateOverlay();
    try {
      if (!upload.uploadUrl) {
        const created = await api("/api/recorder/recordings", {
          method: "POST",
          body: {
            classId: upload.classId,
            startedAt: new Date(upload.startedAtMs).toISOString(),
            endedAt: new Date(upload.endedAtMs).toISOString(),
            durationSeconds: upload.durationSeconds,
            sizeBytes: upload.sizeBytes,
            uploadReason: upload.reason,
          },
        });
        if (created.status === 400 || created.status === 403 || created.status === 404) {
          log(`The server refused this recording: ${created.data?.error || created.status}. Giving up on it.`);
          await discardUpload(upload, "abandoned");
          return;
        }
        if (!created.ok) {
          throw new Error(created.data?.error || `HTTP ${created.status}`);
        }
        upload.recordingId = created.data.recordingId;
        upload.uploadUrl = created.data.uploadUrl;
        await persistUpload(upload);
      }
      state.uploadProgress = { sent: 0, total: upload.sizeBytes };
      const result = await invoke("upload_file", {
        path: upload.outputPath,
        url: upload.uploadUrl,
        contentType: "video/mp4",
      });
      if (result.status < 200 || result.status >= 300) {
        // A rejected signed URL is not worth retrying; start over with a new one.
        upload.uploadUrl = null;
        upload.recordingId = null;
        throw new Error(`upload returned ${result.status} ${result.body}`);
      }
      const completed = await api(`/api/recorder/recordings/${upload.recordingId}/complete`, {
        method: "POST",
        body: { sizeBytes: upload.sizeBytes, durationSeconds: upload.durationSeconds },
      });
      if (!completed.ok) {
        throw new Error(completed.data?.error || `HTTP ${completed.status}`);
      }
      log(`Uploaded the recording for ${upload.courseTitle || upload.classId}.`);
      await discardUpload(upload, "uploaded");
    } catch (error) {
      const delay = Math.min(120000, 5000 * 2 ** Math.min(upload.attempts, 5));
      upload.nextAttemptMs = Date.now() + delay;
      log(`Upload failed (${error}). Retrying in ${Math.round(delay / 1000)} s.`);
      await persistUpload(upload);
    } finally {
      upload.uploading = false;
      state.uploadProgress = null;
      render();
      await updateOverlay();
    }
  };

  const discardUpload = async (upload, reason) => {
    state.pendingFinished = { classId: upload.classId, reason };
    state.uploads = state.uploads.filter((entry) => entry !== upload);
    await invoke("remove_path", { path: upload.dir });
    scheduleTick(500);
  };

  const processUploads = async () => {
    for (const upload of [...state.uploads]) {
      if (!upload.uploading && Date.now() >= upload.nextAttemptMs) {
        await attemptUpload(upload);
      }
    }
  };

  /** On startup: pick up segments and pending uploads from a previous run. */
  const recoverLeftovers = async () => {
    if (state.recovered) {
      return;
    }
    state.recovered = true;
    let entries = [];
    try {
      entries = await invoke("list_dir", { path: state.recordingsDir });
    } catch {
      return;
    }
    for (const entry of entries.filter((item) => item.isDir)) {
      if (state.session && state.session.classId === entry.name) {
        continue; // adopted by createSession
      }
      const pending = await readJson(`${entry.path}/pending.json`);
      if (pending && pending.outputPath) {
        state.uploads.push({ ...pending, dir: entry.path, uploading: false, nextAttemptMs: 0 });
        log(`Found an upload from a previous run for ${pending.courseTitle || entry.name}.`);
        continue;
      }
      const meta = await readJson(`${entry.path}/meta.json`);
      const segments = [];
      for (const segment of meta?.segments || []) {
        try {
          const size = await invoke("file_size", { path: segment.path });
          if (size > 0) {
            segments.push({ ...segment, sizeBytes: size });
          }
        } catch {
          // gone
        }
      }
      if (segments.length === 0) {
        await invoke("remove_path", { path: entry.path });
        continue;
      }
      log(`Recovering a recording from a previous run (${meta?.courseTitle || entry.name}).`);
      await finalizeSegments(
        { classId: entry.name, dir: entry.path, segments, courseTitle: meta?.courseTitle },
        "recovered"
      );
    }
    await processUploads();
  };

  // --- Tick loop -----------------------------------------------------------------

  const currentStateLabel = () => {
    const session = state.session;
    if (state.uploads.some((upload) => upload.uploading)) {
      return "uploading";
    }
    if (!session) {
      return "idle";
    }
    if (session.finalizing) {
      return "finalizing";
    }
    if (session.capturing) {
      return "recording";
    }
    if (session.phase === "live" || session.phase === "after_end") {
      return session.pauseMode === "none" ? "paused" : `paused_${session.pauseMode}`;
    }
    return session.phase;
  };

  const scheduleTick = (delayMs) => {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(loop, delayMs);
  };

  const loop = async () => {
    state.timer = null;
    let interval = state.session || state.uploads.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    if (state.settings.token && !state.tickBusy) {
      state.tickBusy = true;
      try {
        await runTick();
        if (state.tick && state.tick.pollIntervalMs) {
          interval = state.tick.pollIntervalMs;
        }
      } catch (error) {
        state.online = false;
        log(`Cannot reach the server: ${error}`);
        interval = state.session ? ACTIVE_POLL_MS : 10000;
      } finally {
        state.tickBusy = false;
      }
      try {
        if (!state.recovered) {
          await recoverLeftovers();
        }
        await processUploads();
      } catch (error) {
        log(`Upload processing error: ${error}`);
      }
    }
    // Runs signed out too, so a recorder that cannot sign in can still be
    // fixed by an update instead of a reinstall.
    await maybeUpdate();
    render();
    await updateOverlay();
    scheduleTick(interval);
  };

  const runTick = async () => {
    const body = {
      deviceId: state.settings.deviceId,
      deviceName: state.info?.hostName || "",
      platform: state.info?.platform || "",
      appVersion: state.info?.version || "",
      state: currentStateLabel(),
      classId: state.session?.classId ?? null,
      finished: state.pendingFinished,
    };
    const response = await api("/api/recorder/tick", { method: "POST", body });
    if (response.status === 401) {
      state.online = false;
      handleUnauthorized();
      return;
    }
    if (!response.ok) {
      state.online = false;
      log(`Server error ${response.status}: ${response.data?.error || ""}`);
      return;
    }
    state.online = true;
    state.pendingFinished = null;
    state.tick = response.data;
    state.clockOffsetMs = response.data.serverTimeMs - Date.now();
    await applyTick(response.data);
  };

  const handleUnauthorized = () => {
    if (state.session && state.session.phase !== "pre_arm") {
      // Never drop a live class over an auth hiccup; keep recording and retrying.
      log("The server rejected the sign-in token; will keep retrying during this class.");
      return;
    }
    log("Signed out by the server. Please sign in again.");
    state.settings.token = null;
    state.settings.user = null;
    saveSettings();
    render();
  };

  const applyTick = async (tick) => {
    const active = tick.active;
    if (!active) {
      if (state.session && !state.session.finalizing) {
        if (state.session.segments.length > 0 || state.session.capturing) {
          await finalize("recovered");
        } else {
          clearSession();
        }
      }
      await evaluate();
      return;
    }
    if (state.session && state.session.classId !== active.classId && !state.session.finalizing) {
      await finalize("channel_deleted");
    }
    if (!state.session) {
      await createSession(active);
    }
    const session = state.session;
    session.phase = active.phase;
    session.startsAtMs = active.startsAtMs;
    session.endsAtMs = active.endsAtMs;
    session.courseTitle = active.courseTitle;
    session.classTitle = active.classTitle;
    session.mustFinalize = Boolean(active.mustFinalize);
    session.liveChannel = active.liveChannel;
    session.presenceReason = active.presenceReason || null;
    if (typeof active.tutorInLiveChannel === "boolean") {
      if (active.tutorInLiveChannel !== session.inCall) {
        log(active.tutorInLiveChannel ? "You joined the class voice channel." : "You are not in the class voice channel.");
      }
      session.inCall = active.tutorInLiveChannel;
    }
    await evaluate();
  };

  // --- Decisions -------------------------------------------------------------------

  const setQuitLock = async (locked) => {
    if (state.quitLocked === locked) {
      return;
    }
    state.quitLocked = locked;
    try {
      await invoke("set_quit_lock", { locked });
    } catch (error) {
      log(`Could not update the quit lock: ${error}`);
    }
  };

  const evaluate = async () => {
    if (state.evaluating) {
      state.reevaluate = true;
      return;
    }
    state.evaluating = true;
    try {
      await evaluateInner();
    } catch (error) {
      log(`Error: ${error}`);
    } finally {
      state.evaluating = false;
    }
    if (state.reevaluate) {
      state.reevaluate = false;
      await evaluate();
    }
  };

  const evaluateInner = async () => {
    const session = state.session;
    const uploadsPending = state.uploads.length > 0;
    if (!session) {
      await setQuitLock(uploadsPending);
      render();
      await updateOverlay();
      return;
    }
    await setQuitLock(session.phase !== "pre_arm" || session.finalizing || uploadsPending);
    if (session.finalizing) {
      render();
      await updateOverlay();
      return;
    }

    const ready = devicesReady();
    state.deviceChoiceNeeded = !ready;
    if (!ready && state.devicePromptShownForClass !== session.classId) {
      state.devicePromptShownForClass = session.classId;
      showView("devices");
      try {
        await invoke("show_main_window");
      } catch {
        // ignore
      }
      log(`Before this class: ${deviceProblems().join(" ")}`);
    }

    if (session.phase === "pre_arm" || session.phase === "armed") {
      if (session.capturing) {
        await stopSegment();
      }
      render();
      await updateOverlay();
      return;
    }

    if (session.mustFinalize) {
      log("The live voice channel has been removed.");
      await finalize("channel_deleted");
      return;
    }

    if (session.capturing) {
      const status = await invoke("capture_status");
      if (!status.running) {
        await handleCaptureExit(status);
      }
    }

    const wantCapture =
      session.inCall && session.pauseMode === "none" && ready && !session.captureDisabled;
    if (wantCapture && !session.capturing) {
      await startSegment();
    } else if (!wantCapture && session.capturing) {
      await stopSegment();
    }

    if (session.inCall) {
      // Back in the call: a later exit past the end should ask again.
      session.prompted = false;
    }
    if (session.phase === "after_end" && !session.inCall && !session.prompted && !session.promptOpen) {
      openDonePrompt();
    }
    render();
    await updateOverlay();
  };

  const handleHotkey = async () => {
    const session = state.session;
    if (!session || session.finalizing || !(session.phase === "live" || session.phase === "after_end")) {
      return;
    }
    if (session.pauseMode !== "none") {
      session.pauseMode = "none";
      log("Pause cleared.");
    } else if (session.inCall) {
      session.pauseMode = "manual";
      log("Recording paused by hotkey.");
    } else {
      session.pauseMode = "forced";
      log("Force-paused: recording will not resume by itself when you join the call.");
    }
    await evaluate();
  };

  // --- Prompts -----------------------------------------------------------------------

  const openDonePrompt = () => {
    const session = state.session;
    if (!session) {
      return;
    }
    session.promptOpen = true;
    $("modal-done").hidden = false;
    invoke("show_main_window").catch(() => {});
  };

  const closeDonePrompt = () => {
    $("modal-done").hidden = true;
    if (state.session) {
      state.session.promptOpen = false;
    }
  };

  // --- Overlay -------------------------------------------------------------------------

  const overlayState = () => {
    const session = state.session;
    const hotkey = state.hotkeyLabel;
    const displayIndex = chosenDisplay()?.index ?? null;
    const uploading = state.uploads.find((upload) => upload.uploading);
    if (uploading) {
      const progress = state.uploadProgress;
      const percent = progress && progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
      return { mode: "uploading", title: `Uploading recording ${percent}%`, detail: "Keep the computer on and connected.", blocking: false, displayIndex };
    }
    if (!session) {
      return state.uploads.length > 0
        ? { mode: "uploading", title: "Recording waiting to upload", detail: "Retrying automatically.", blocking: false, displayIndex }
        : { mode: "hidden" };
    }
    if (session.finalizing) {
      return { mode: "uploading", title: "Finishing the recording…", detail: "", blocking: false, displayIndex };
    }
    if (session.phase === "pre_arm" || session.phase === "armed") {
      if (state.deviceChoiceNeeded) {
        return { mode: "attention", title: "Choose your devices in YanLearn Recorder", detail: `Class starts at ${formatClock(session.startsAtMs)}.`, blocking: session.phase === "armed", displayIndex };
      }
      return { mode: "armed", title: "Recorder ready — class starts in {countdown}", detail: "Recording starts automatically once you are in the voice channel.", blocking: false, displayIndex, countdownToMs: session.startsAtMs - state.clockOffsetMs };
    }
    if (session.capturing) {
      return {
        mode: "recording",
        title: "REC {elapsed}",
        detail: session.systemAudioActive ? `${session.courseTitle}` : `${session.courseTitle} — system audio off`,
        blocking: false,
        displayIndex,
        recordingSinceMs: session.recordingStartedAtMs ? session.recordingStartedAtMs - state.clockOffsetMs : Date.now(),
      };
    }
    if (state.deviceChoiceNeeded) {
      return { mode: "attention", title: "NOT RECORDING — choose your devices", detail: "Open YanLearn Recorder and pick a display, microphone, and speaker.", blocking: true, displayIndex };
    }
    if (session.captureDisabled) {
      return { mode: "attention", title: "NOT RECORDING — recording keeps failing", detail: "Open YanLearn Recorder and tell a founder.", blocking: true, displayIndex };
    }
    if (session.pauseMode === "manual") {
      return { mode: "paused", title: "RECORDING PAUSED", detail: `You are in the class call but not recording. Press ${hotkey} to resume.`, blocking: true, displayIndex };
    }
    if (session.pauseMode === "forced") {
      return session.inCall
        ? { mode: "forced", title: "FORCE-PAUSED — NOT RECORDING", detail: `Recording will not resume by itself. Press ${hotkey} to resume.`, blocking: true, displayIndex }
        : { mode: "forced", title: "Force-paused", detail: `Recording will not resume when you join the call. Press ${hotkey} to unpause.`, blocking: false, displayIndex };
    }
    if (!session.inCall) {
      return { mode: "paused", title: "Paused — not in the class voice channel", detail: session.presenceReason || "Recording resumes the moment you join.", blocking: false, displayIndex };
    }
    return { mode: "paused", title: "Starting recording…", detail: "", blocking: false, displayIndex };
  };

  const updateOverlay = async () => {
    const next = overlayState();
    const json = JSON.stringify(next);
    if (json === state.lastOverlayJson) {
      return;
    }
    state.lastOverlayJson = json;
    try {
      await invoke("set_overlay", { state: next });
    } catch (error) {
      log(`Overlay error: ${error}`);
    }
  };

  // --- Updates -----------------------------------------------------------------------------

  // Updating restarts the app, so it may only happen when losing the process
  // costs nothing: connected to the server (so "no class" is a fresh fact),
  // nothing recording, nothing waiting to upload, and no class close enough
  // that the restart could eat into its pre-arm window.
  const updateSafeNow = () => {
    if (state.update.installing) {
      return false;
    }
    if (state.quitLocked || state.session || state.uploads.length > 0) {
      return false;
    }
    // Signed out there is no class to interrupt — and an update is the only
    // way out of a bug that stops the app signing in at all.
    if (!state.settings.token) {
      return true;
    }
    if (!state.online) {
      return false;
    }
    const next = state.tick?.nextClass;
    if (next && next.startsAtMs - serverNow() < UPDATE_QUIET_WINDOW_MS) {
      return false;
    }
    return true;
  };

  const checkForUpdate = async ({ manual = false } = {}) => {
    if (state.update.checking || state.update.installing) {
      return;
    }
    state.update.checking = true;
    state.update.lastCheckAt = Date.now();
    try {
      const info = await invoke("check_update");
      state.update.info = info || null;
      state.update.ready = false;
      if (info) {
        log(`Update available: v${info.version} (this is v${info.currentVersion}).`);
      } else if (manual) {
        log("YanLearn Recorder is up to date.");
      }
    } catch (error) {
      if (manual) {
        log(`Could not check for updates: ${error}`);
      }
    } finally {
      state.update.checking = false;
    }
    render();
  };

  // Downloading is harmless — it only costs bandwidth — so it runs in the
  // background rather than blocking the tick loop. However long it takes, the
  // decision to install is taken again afterwards.
  const downloadUpdate = () => {
    if (state.update.downloading || state.update.ready || !state.update.info) {
      return;
    }
    const version = state.update.info.version;
    state.update.downloading = true;
    state.update.progress = null;
    log(`Downloading update v${version} in the background.`);
    invoke("download_update")
      .then(() => {
        state.update.ready = true;
        log(`Update v${version} is downloaded and installs at the next safe moment.`);
      })
      .catch((error) => {
        state.update.info = null;
        log(`Could not download the update: ${error}`);
      })
      .finally(() => {
        state.update.downloading = false;
        render();
      });
  };

  const installUpdate = async () => {
    const info = state.update.info;
    if (!info || !state.update.ready || state.update.installing || !updateSafeNow()) {
      return;
    }
    state.update.installing = true;
    $("update-modal-title").textContent = `Updating to v${info.version}`;
    $("modal-update").hidden = false;
    render();
    log(`Installing update v${info.version}; the recorder will restart.`);
    try {
      // The restarted app reads this back: it says which version to expect and
      // whether the recorder was living in the tray rather than on screen.
      let visible = true;
      try {
        visible = await invoke("main_window_visible");
      } catch {
        // assume it was visible
      }
      state.settings.pendingUpdate = { version: info.version, hidden: !visible };
      await saveSettings();
      // On Windows the installer ends this process; on macOS the app relaunches.
      await invoke("install_update");
    } catch (error) {
      state.update.installing = false;
      state.update.info = null;
      state.update.ready = false;
      state.settings.pendingUpdate = null;
      await saveSettings();
      $("modal-update").hidden = true;
      log(`The update could not be installed: ${error}`);
      render();
    }
  };

  // Called once per tick: check every few hours, then download and install at
  // the first safe moment. An update found during a class waits it out.
  const maybeUpdate = async () => {
    if (state.update.installing) {
      return;
    }
    if (!state.update.info && Date.now() - state.update.lastCheckAt >= UPDATE_CHECK_INTERVAL_MS) {
      await checkForUpdate();
    }
    if (!state.update.info || !updateSafeNow()) {
      return;
    }
    if (state.update.ready) {
      await installUpdate();
    } else {
      downloadUpdate();
    }
  };

  const renderUpdate = () => {
    const notice = $("update-notice");
    const info = state.update.info;
    if (!info || state.update.installing) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    const ready = state.update.ready;
    const progress = state.update.progress;
    const percent =
      !ready && progress && progress.total
        ? ` ${Math.round((progress.downloaded / progress.total) * 100)}%`
        : "";
    $("update-text").textContent = updateSafeNow()
      ? `Update v${info.version} — ${ready ? "installing now…" : `downloading${percent}…`}`
      : `Update v${info.version} installs by itself once you are between classes.`;
    $("update-install").hidden = !(ready && updateSafeNow());
  };

  // --- Rendering ---------------------------------------------------------------------------

  const showView = (name) => {
    $("view-login").hidden = name !== "login";
    $("view-main").hidden = name !== "main";
    $("panel-devices").hidden = name !== "devices";
  };

  const render = () => {
    const settings = state.settings;
    if (!settings) {
      return;
    }
    $("version-label").textContent = state.info ? `v${state.info.version}` : "";
    const pill = $("connection-pill");
    pill.textContent = state.online ? "Connected" : settings.token ? "Reconnecting…" : "Signed out";
    pill.className = `status-pill${state.online ? " online" : ""}`;
    $("hotkey-label").textContent = state.hotkeyLabel;

    if (!settings.token) {
      if ($("view-login").hidden && $("panel-devices").hidden) {
        showView("login");
      }
      $("login-server").value = settings.serverUrl;
      return;
    }
    if (!$("view-login").hidden) {
      showView("main");
    }

    $("user-label").textContent = settings.user ? `Signed in as ${settings.user.fullName || settings.user.email}` : "";
    $("signout-button").disabled = state.quitLocked;
    $("lock-notice").hidden = !state.quitLocked;
    $("device-notice").hidden = !state.deviceChoiceNeeded;
    $("device-notice").textContent = state.deviceChoiceNeeded
      ? deviceProblems().join(" ")
      : "";
    renderUpdate();

    const session = state.session;
    const dot = $("state-dot");
    const uploading = state.uploads.find((upload) => upload.uploading);
    const timer = $("state-timer");
    const progressEl = $("upload-progress");
    progressEl.hidden = !uploading;
    if (uploading && state.uploadProgress && state.uploadProgress.total > 0) {
      $("upload-bar").style.width = `${Math.round((state.uploadProgress.sent / state.uploadProgress.total) * 100)}%`;
    }

    if (!session) {
      const next = state.tick?.nextClass;
      $("class-label").textContent = next ? "Next class" : "No class right now";
      $("class-title").textContent = next ? `${next.courseTitle} — ${next.classTitle}` : "";
      $("class-detail").textContent = next
        ? `${new Date(next.startsAtMs).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Keep the recorder open; it arms itself 5 minutes before.`
        : "The recorder arms itself 15 minutes before each of your classes. Keep it open.";
      dot.className = `dot${uploading ? " uploading" : ""}`;
      $("state-text").textContent = uploading
        ? "Uploading recording"
        : state.uploads.length > 0
          ? "Recording waiting to upload"
          : "Idle";
      timer.textContent = "";
      $("presence-text").textContent = "";
      return;
    }

    $("class-label").textContent = session.phase === "after_end" ? "Class ended" : session.phase === "live" ? "Class in progress" : "Upcoming class";
    $("class-title").textContent = `${session.courseTitle} — ${session.classTitle}`;
    $("class-detail").textContent = `${formatClock(session.startsAtMs)} – ${formatClock(session.endsAtMs)}`;

    let text = "";
    let cls = "";
    if (session.finalizing) {
      text = "Finishing the recording";
      cls = "uploading";
      timer.textContent = "";
    } else if (session.phase === "pre_arm") {
      text = "Getting ready";
      cls = "armed";
      timer.textContent = `starts in ${formatCountdown(session.startsAtMs)}`;
    } else if (session.phase === "armed") {
      text = "Armed";
      cls = "armed";
      timer.textContent = `starts in ${formatCountdown(session.startsAtMs)}`;
    } else if (session.capturing) {
      text = "Recording";
      cls = "recording";
      timer.textContent = session.recordingStartedAtMs ? formatElapsed(session.recordingStartedAtMs - state.clockOffsetMs) : "";
    } else if (session.pauseMode === "manual") {
      text = "Paused (hotkey)";
      cls = "paused";
      timer.textContent = "";
    } else if (session.pauseMode === "forced") {
      text = "Force-paused";
      cls = "paused";
      timer.textContent = "";
    } else if (!session.inCall) {
      text = "Paused — waiting for you to join the voice channel";
      cls = "paused";
      timer.textContent = "";
    } else {
      text = "Starting…";
      cls = "paused";
      timer.textContent = "";
    }
    $("state-text").textContent = text;
    dot.className = `dot ${cls}`;
    $("presence-text").textContent =
      session.phase === "live" || session.phase === "after_end"
        ? session.inCall
          ? "You are in the class voice channel."
          : session.presenceReason || "You are not in the class voice channel."
        : "";
  };

  const renderDevices = () => {
    const settings = state.settings;
    const list = $("display-list");
    list.innerHTML = "";
    const current = chosenDisplay();
    for (const display of state.displays) {
      const option = document.createElement("div");
      option.className = `option${current && current.index === display.index ? " selected" : ""}`;
      option.innerHTML = `<div class="num">${display.index + 1}</div><div><div class="name"></div><div class="meta"></div></div>`;
      option.querySelector(".name").textContent = `${display.name}${display.primary ? " (main)" : ""}`;
      option.querySelector(".meta").textContent = `${display.width} × ${display.height}`;
      option.addEventListener("click", () => {
        settings.display = pickDisplay(display);
        saveSettings();
        renderDevices();
      });
      list.appendChild(option);
    }
    if (state.displays.length === 0) {
      list.textContent = "No displays found.";
    }

    const micSelect = $("mic-select");
    micSelect.innerHTML = "";
    const mics = state.probe?.microphones || [];
    if (mics.length === 0) {
      micSelect.appendChild(new Option("No microphone found", ""));
      micSelect.disabled = true;
      $("mic-help").textContent = "Your voice will not be recorded. Plug in a microphone and refresh.";
    } else {
      micSelect.disabled = mics.length === 1;
      if (mics.length > 1) {
        micSelect.appendChild(new Option("Choose a microphone…", ""));
      }
      for (const mic of mics) {
        micSelect.appendChild(new Option(mic.name, mic.id));
      }
      micSelect.value = chosenMicrophone()?.id ?? "";
      $("mic-help").textContent = mics.length > 1 ? "Pick the microphone you talk into during class." : "";
    }

    const outputSelect = $("output-select");
    outputSelect.innerHTML = "";
    const outputs = state.probe?.outputs || [];
    if (state.info?.platform === "macos") {
      outputSelect.appendChild(new Option("All system audio (macOS)", ""));
      outputSelect.disabled = true;
      $("output-help").textContent =
        state.probe?.systemAudio === "helper"
          ? "macOS records the audio of every app regardless of which speaker it plays through."
          : "System audio capture needs macOS 13 or newer.";
    } else if (outputs.length === 0) {
      outputSelect.appendChild(new Option("No speaker found", ""));
      outputSelect.disabled = true;
      $("output-help").textContent = "";
    } else {
      outputSelect.disabled = outputs.length === 1 || !settings.systemAudio;
      if (outputs.length > 1) {
        outputSelect.appendChild(new Option("Choose a speaker…", ""));
      }
      for (const output of outputs) {
        outputSelect.appendChild(new Option(output.name, output.id));
      }
      outputSelect.value = chosenOutput()?.id ?? "";
      $("output-help").textContent =
        outputs.length > 1 ? "Pick the speaker or headset you listen to Discord with; its audio (your students) is recorded." : "";
    }

    $("sysaudio-check").checked = settings.systemAudio !== false;
    $("hwenc-check").checked = settings.hardwareEncoding !== false;
    const probe = state.probe;
    $("probe-info").textContent = probe
      ? `${probe.ffmpegOk ? probe.ffmpegVersion : "ffmpeg missing"} · encoders: ${(probe.encoders || []).join(", ") || "none"}`
      : "";
  };

  // --- Wiring --------------------------------------------------------------------------------

  const wireEvents = () => {
    $("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("login-button");
      const errorEl = $("login-error");
      errorEl.hidden = true;
      button.disabled = true;
      try {
        const server = $("login-server").value.trim().replace(/\/+$/, "");
        if (server) {
          state.settings.serverUrl = server;
        }
        const response = await api("/api/recorder/auth/login", {
          method: "POST",
          auth: false,
          body: {
            email: $("login-email").value.trim(),
            password: $("login-password").value,
            deviceId: state.settings.deviceId,
            deviceName: state.info?.hostName || "",
            platform: state.info?.platform || "",
            appVersion: state.info?.version || "",
          },
        });
        if (!response.ok) {
          errorEl.textContent = response.data?.error || `Sign in failed (${response.status}).`;
          errorEl.hidden = false;
          return;
        }
        state.settings.token = response.data.token;
        state.settings.user = response.data.user;
        await saveSettings();
        $("login-password").value = "";
        log(`Signed in as ${response.data.user.email}.`);
        showView("main");
        render();
        scheduleTick(0);
      } catch (error) {
        errorEl.textContent = `Could not reach the server: ${error}`;
        errorEl.hidden = false;
      } finally {
        button.disabled = false;
      }
    });

    $("signout-button").addEventListener("click", async () => {
      if (state.quitLocked) {
        $("modal-quit").hidden = false;
        return;
      }
      try {
        await api("/api/recorder/auth/logout", { method: "POST" });
      } catch {
        // offline; the token simply expires
      }
      state.settings.token = null;
      state.settings.user = null;
      await saveSettings();
      state.online = false;
      state.tick = null;
      // Keep the loop alive: it no longer ticks, but it still checks for updates.
      scheduleTick(IDLE_POLL_MS);
      showView("login");
      render();
      await updateOverlay();
    });

    $("devices-button").addEventListener("click", async () => {
      showView("devices");
      await refreshDevices();
    });
    $("devices-refresh").addEventListener("click", refreshDevices);
    $("identify-button").addEventListener("click", () => invoke("identify_displays").catch((error) => log(`${error}`)));
    $("devices-save").addEventListener("click", async () => {
      await saveSettings();
      showView("main");
      await evaluate();
    });
    $("mic-select").addEventListener("change", (event) => {
      const mic = (state.probe?.microphones || []).find((item) => item.id === event.target.value) || null;
      state.settings.microphoneId = mic ? mic.id : null;
      state.settings.microphoneName = mic ? mic.name : null;
      saveSettings();
    });
    $("output-select").addEventListener("change", (event) => {
      const output = (state.probe?.outputs || []).find((item) => item.id === event.target.value) || null;
      state.settings.outputId = output ? output.id : null;
      state.settings.outputName = output ? output.name : null;
      saveSettings();
    });
    $("sysaudio-check").addEventListener("change", (event) => {
      state.settings.systemAudio = event.target.checked;
      saveSettings();
      renderDevices();
    });
    $("hwenc-check").addEventListener("change", (event) => {
      state.settings.hardwareEncoding = event.target.checked;
      state.settings.encoder = null;
      saveSettings();
    });
    $("refresh-button").addEventListener("click", () => scheduleTick(0));
    $("update-check").addEventListener("click", () => checkForUpdate({ manual: true }));
    $("update-install").addEventListener("click", () => installUpdate());
    $("done-yes").addEventListener("click", () => finalize("tutor_confirmed"));
    $("done-no").addEventListener("click", () => {
      if (state.session) {
        state.session.prompted = true;
      }
      closeDonePrompt();
      log("Waiting: the recording uploads once the live voice channel is removed.");
    });
    $("quit-ok").addEventListener("click", () => {
      $("modal-quit").hidden = true;
    });

    listen("hotkey", () => {
      handleHotkey();
    });
    listen("quit-blocked", () => {
      $("modal-quit").hidden = false;
    });
    listen("upload-progress", (event) => {
      state.uploadProgress = event.payload;
      render();
      updateOverlay();
    });
    listen("update-progress", (event) => {
      state.update.progress = event.payload || null;
      renderUpdate();
    });
    listen("hidden-to-tray", () => {
      log("YanLearn Recorder keeps running in the tray / menu bar.");
    });

    // A cheap once-a-second refresh keeps countdowns and timers moving.
    setInterval(() => {
      if (state.session && !$("view-main").hidden) {
        render();
      }
    }, 1000);
  };

  // --- Boot ------------------------------------------------------------------------------------

  const init = async () => {
    try {
      state.info = await invoke("app_info");
    } catch (error) {
      console.error(error);
    }
    state.hotkeyLabel = state.info?.platform === "macos" ? "⌘+Option+P" : "Ctrl+Alt+P";
    await loadSettings();
    // Coming back from an automatic update: say so, and go back to the tray if
    // that is where the recorder was when it restarted itself.
    const pendingUpdate = state.settings.pendingUpdate;
    if (pendingUpdate) {
      state.settings.pendingUpdate = null;
      await saveSettings();
      if (pendingUpdate.version === state.info?.version) {
        log(`Updated to v${pendingUpdate.version}.`);
        if (pendingUpdate.hidden && state.settings.token) {
          invoke("hide_main_window").catch(() => {});
        }
      } else {
        log(`The update to v${pendingUpdate.version} did not finish; still on v${state.info?.version || "?"}.`);
      }
    }
    state.recordingsDir = await invoke("recordings_dir");
    wireEvents();
    try {
      await invoke("register_hotkey", { combo: state.settings.hotkey || DEFAULT_HOTKEY });
    } catch (error) {
      log(`${error}`);
    }
    render();
    showView(state.settings.token ? "main" : "login");
    await refreshDevices();
    scheduleTick(0);
  };

  init().catch((error) => {
    console.error(error);
    log(`Startup error: ${error}`);
  });
})();
