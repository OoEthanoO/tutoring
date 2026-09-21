// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("recorder/src/index.html", "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)]
  .map(([, path]) => readFileSync(`recorder/src/${path}`, "utf8"));
const $ = id => document.getElementById(id);
const rootDir = "recordings";
let invoke, files, directories, sizes, active, transfer, concat, serverCreate;
const calls = name => invoke.mock.calls.filter(([command]) => command === name);
const tickCalls = () => fetch.mock.calls.filter(([url]) => url.endsWith("/tick"));
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const save = (path, data) => files.set(path, JSON.stringify(data));
const meta = (id = "class-one") => ({
  classId: id, courseTitle: "Science", classTitle: "Class 7",
  startsAtMs: Date.now() - 7200000, endsAtMs: Date.now() - 3600000, segments: [],
  currentSegment: { path: `${rootDir}/${id}/seg-001.mp4`, startedAtMs: Date.now() - 7200000, endedAtMs: Date.now() - 3600000 },
});
const addRecording = (id = "class-one") => {
  const data = meta(id);
  directories.push({ name: id, path: `${rootDir}/${id}`, isDir: true });
  save(`${rootDir}/${id}/meta.json`, data);
  sizes.set(data.currentSegment.path, 12345);
  return data;
};
const addPending = (id = "class-one", overrides = {}) => {
  const data = addRecording(id);
  save(`${rootDir}/${id}/pending.json`, {
    classId: id, dir: `${rootDir}/${id}`, courseTitle: data.courseTitle,
    outputPath: `${rootDir}/${id}/recording.mp4`, sizeBytes: 12345,
    startedAtMs: data.startsAtMs, endedAtMs: data.endsAtMs, durationSeconds: 3600,
    attempts: 0, reason: "tutor_confirmed", ...overrides,
  });
};
const boot = async () => { scripts.forEach(source => window.eval(source)); await vi.advanceTimersByTimeAsync(5); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1];
  vi.spyOn(console, "log").mockImplementation(() => {});
  files = new Map(); sizes = new Map(); directories = []; active = null;
  transfer = vi.fn(async () => ({ status: 200 }));
  concat = vi.fn(async () => 12345);
  serverCreate = vi.fn(async () => jsonResponse({ recordingId: "upload-one", uploadUrl: "https://storage.example.test/recording" }));
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url.endsWith("/tick")) return jsonResponse({ serverTimeMs: Date.now(), active, nextClass: null, pollIntervalMs: 2000 });
    if (url.endsWith("/complete")) return jsonResponse({ ok: true });
    if (url.endsWith("/recordings")) return serverCreate();
    throw new Error(`Unexpected network call: ${url}`);
  }));
  invoke = vi.fn(async (command, args) => {
    switch (command) {
      case "app_info": return { platform: "macos", version: "0.5.1" };
      case "load_settings": return { token: "test-token", user: { fullName: "Tutor" } };
      case "recordings_dir": return rootDir;
      case "register_hotkeys": return { pause: "CmdOrCtrl+Alt+P", mute: "CmdOrCtrl+Alt+M", warnings: [] };
      case "list_displays": return [{ index: 0, name: "Display", width: 1920, height: 1080, x: 0, y: 0, scaleFactor: 1 }];
      case "probe_capture": return { ffmpegOk: true, microphones: [], outputs: [], encoders: [], screens: [{ index: 0, name: "Capture screen 0" }] };
      case "list_windows": return [];
      case "list_dir": return args.path === rootDir ? [...directories]
        : [...sizes].filter(([path]) => path.startsWith(args.path + "/")).map(([path, size]) => ({ name: path.split("/").at(-1), path, size, isDir: false }));
      case "read_text_file": return files.get(args.path) ?? null;
      case "write_text_file": files.set(args.path, args.contents); return;
      case "file_size": return sizes.get(args.path) || 0;
      case "concat_segments": return concat(args);
      case "upload_file": return transfer(args);
      case "remove_path": {
        for (const path of files.keys()) if (path.startsWith(args.path + "/")) files.delete(path);
        directories = directories.filter(dir => dir.path !== args.path);
        return;
      }
      case "start_capture": return { encoder: "libx264", backend: "avfoundation", systemAudio: true, warnings: [] };
      case "capture_status": return { running: true };
      case "stop_capture": return { sizeBytes: 12345, seconds: 3600 };
      case "check_update": return null;
      default: return undefined;
    }
  });
  window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn(async () => {}) } };
});

afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete window.__TAURI__; document.body.innerHTML = "";
});

describe("Recorder restart and upload lifecycle", () => {
  it("recovers the in-flight segment after a forced shutdown before pending.json existed", async () => {
    const data = addRecording();
    await boot();
    expect(concat).toHaveBeenCalledWith({ segments: [data.currentSegment.path], output: "recordings/class-one/recording.mp4" });
    expect(transfer).toHaveBeenCalledOnce();
    expect(calls("remove_path")).toHaveLength(1);
    expect($("log").textContent).toContain("Recovering a recording");
    expect($("log").textContent).toContain("Uploaded the recording");
  });

  it("continues ticking and recording another class during a long upload", async () => {
    addPending();
    let finish;
    transfer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    active = { classId: "next-class", courseTitle: "Next course", classTitle: "Class 1", phase: "live", startsAtMs: Date.now() - 1000, endsAtMs: Date.now() + 3600000, tutorInLiveChannel: true };
    await boot();
    await vi.advanceTimersByTimeAsync(6500);
    expect(tickCalls().length).toBeGreaterThanOrEqual(3);
    expect(calls("start_capture")).toHaveLength(1);
    expect(JSON.parse(tickCalls().at(-1)[1].body).state).toBe("recording");
    expect(calls("set_overlay").at(-1)[1].state.mode).toBe("recording");
    expect(transfer).toHaveBeenCalledOnce();
    finish({ status: 200 }); await vi.advanceTimersByTimeAsync(5);
  });

  it("does not adopt or re-record the class that is already uploading", async () => {
    addPending();
    let finish;
    transfer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    active = { ...meta(), phase: "after_end", tutorInLiveChannel: true };
    await boot(); await vi.advanceTimersByTimeAsync(5000);
    expect(calls("start_capture")).toHaveLength(0);
    expect(concat).not.toHaveBeenCalled();
    expect(transfer).toHaveBeenCalledOnce();
    finish({ status: 200 }); await vi.advanceTimersByTimeAsync(5);
  });

  it("keeps a refused recording and lets Refresh retry it", async () => {
    addPending();
    serverCreate.mockResolvedValueOnce(jsonResponse({ error: "Upload window expired" }, 400));
    await boot();
    expect(calls("remove_path")).toHaveLength(0);
    expect(files.has("recordings/class-one/pending.json")).toBe(true);
    expect($("state-text").textContent).toContain("needs attention");
    await vi.advanceTimersByTimeAsync(5000);
    expect(serverCreate).toHaveBeenCalledOnce();
    $("refresh-button").click(); await vi.advanceTimersByTimeAsync(5);
    expect(transfer).toHaveBeenCalledOnce();
    expect(calls("remove_path")).toHaveLength(1);
  });

  it("preserves unreadable metadata and still recovers other classes", async () => {
    addRecording("broken"); files.set("recordings/broken/meta.json", '{"segments":');
    addPending("good");
    await boot();
    expect(calls("remove_path").map(([, args]) => args.path)).toEqual(["recordings/good"]);
    expect(files.has("recordings/broken/meta.json")).toBe(true);
    expect($("log").textContent).toContain("Files kept at recordings/broken");
  });

  it("never deletes orphaned video files just because their metadata is missing", async () => {
    addRecording(); files.delete("recordings/class-one/meta.json");
    await boot();
    expect(calls("remove_path")).toHaveLength(0);
    expect($("log").textContent).toContain("Video files exist");
  });

  it("keeps every segment when preparation fails, then retries on Refresh", async () => {
    addRecording(); concat.mockRejectedValueOnce(new Error("disk busy"));
    await boot();
    expect(transfer).not.toHaveBeenCalled();
    expect(calls("remove_path")).toHaveLength(0);
    expect(files.has("recordings/class-one/meta.json")).toBe(true);
    $("refresh-button").click(); await vi.advanceTimersByTimeAsync(5);
    expect(transfer).toHaveBeenCalledOnce();
  });

  it("checkpoints the active segment before native shutdown and retries failed finalization", async () => {
    active = { classId: "live-class", courseTitle: "Science", classTitle: "Class 7", phase: "live", startsAtMs: Date.now() - 3600000, endsAtMs: Date.now() + 1000, tutorInLiveChannel: true };
    await boot();
    expect(calls("start_capture")).toHaveLength(1);
    concat.mockRejectedValueOnce(new Error("disk temporarily busy"));
    $("done-yes").click(); await vi.advanceTimersByTimeAsync(5);
    const events = invoke.mock.calls.map(([command]) => command);
    const stopIndex = events.indexOf("stop_capture");
    const savedBeforeStop = invoke.mock.calls.slice(0, stopIndex).filter(([command]) => command === "write_text_file").at(-1)[1];
    expect(JSON.parse(savedBeforeStop.contents)).toMatchObject({ finalizeReason: "tutor_confirmed", currentSegment: { path: "recordings/live-class/seg-001.mp4" } });
    expect($("state-text").textContent).toContain("retrying preparation");
    await vi.advanceTimersByTimeAsync(32000);
    expect(concat).toHaveBeenCalledTimes(2);
    expect(transfer).toHaveBeenCalledOnce();
  });

  it("times out a stuck completion call, keeps the video, and retries verification without retransferring", async () => {
    addPending();
    const original = fetch.getMockImplementation();
    let completionCalls = 0;
    fetch.mockImplementation((url, options) => {
      if (url.endsWith("/complete") && completionCalls++ === 0) {
        return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("request timed out"))));
      }
      return original(url, options);
    });
    await boot();
    expect($("state-text").textContent).toBe("Verifying uploaded recording");
    await vi.advanceTimersByTimeAsync(31000);
    expect(calls("remove_path")).toHaveLength(0);
    expect(JSON.parse(files.get("recordings/class-one/pending.json")).transferComplete).toBe(true);
    await vi.advanceTimersByTimeAsync(12000);
    expect(transfer).toHaveBeenCalledOnce();
    expect(calls("remove_path")).toHaveLength(1);
  });
});
