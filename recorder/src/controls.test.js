// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("recorder/src/index.html", "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)]
  .map(([, path]) => readFileSync(`recorder/src/${path}`, "utf8"));
const $ = id => document.getElementById(id);
const flush = () => vi.advanceTimersByTimeAsync(1);
const click = async id => { $(id).click(); await flush(); };
let invoke, handlers, registered;
const overlay = () => invoke.mock.calls.filter(([command]) => command === "set_overlay").at(-1)?.[1].state;
const hotkey = async name => { handlers[name]({ payload: null }); await flush(); };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1];
  handlers = {};
  registered = { pause: "CmdOrCtrl+Alt+P", mute: "CmdOrCtrl+Alt+M", warnings: [] };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
    serverNow: Date.now(), active: null, nextClass: null, warnings: [],
  }) })));
  invoke = vi.fn(async command => {
    switch (command) {
      case "app_info": return { platform: "windows", version: "0.5.1" };
      case "load_settings": return { token: "test-token", user: { fullName: "Test tutor" } };
      case "recordings_dir": return "mock-recordings";
      case "register_hotkeys": return registered;
      case "list_displays": return [{ index: 0, name: "Test display", width: 1920, height: 1080, x: 0, y: 0, scaleFactor: 1 }];
      case "probe_capture": return { ffmpegOk: true, microphones: [{ id: "mic", name: "Test mic" }], outputs: [], encoders: [] };
      case "list_windows": case "list_dir": return [];
      case "check_update": return null;
      case "main_window_visible": return true;
      default: return undefined;
    }
  });
  window.__TAURI__ = {
    core: { invoke },
    event: { listen: vi.fn(async (event, handler) => { handlers[event] = handler; }) },
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__TAURI__;
  document.body.innerHTML = "";
});

const boot = async () => { scripts.forEach(source => window.eval(source)); await flush(); };

describe("Recorder practice controls", () => {
  it("shows and clears the microphone warning from the native mute event", async () => {
    await boot();
    await click("test-button");
    expect(overlay()).toMatchObject({ mode: "recording", blocking: false });
    invoke.mockClear();
    fetch.mockClear();
    for (let cycle = 0; cycle < 3; cycle++) {
      await hotkey("mute-hotkey");
      expect($("mute-button").textContent).toBe("Unmute my mic");
      expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED", blocking: true });
      await hotkey("mute-hotkey");
      expect(overlay()).toMatchObject({ mode: "recording", blocking: false });
    }
    expect(fetch).not.toHaveBeenCalled();
    for (const command of ["start_capture", "stop_capture", "write_text_file", "extract_last_frame", "upload_recording"]) {
      expect(invoke.mock.calls.some(([called]) => called === command)).toBe(false);
    }
  });

  it("shows the same mute warning from the button and after resuming a pause", async () => {
    await boot();
    await click("test-button");
    await click("mute-button");
    expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED", blocking: true });
    await hotkey("hotkey");
    expect(overlay()).toMatchObject({ title: "RECORDING PAUSED", blocking: true });
    await hotkey("hotkey");
    expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED", blocking: true });
    await click("mute-button");
    expect(overlay()).toMatchObject({ mode: "recording", blocking: false });
  });

  it("displays the working fallback when Windows cannot register Ctrl+Alt+M", async () => {
    registered.mute = "CmdOrCtrl+Alt+Shift+M";
    registered.warnings = ["Could not register the mute hotkey CmdOrCtrl+Alt+M: HotKey already registered"];
    await boot();
    expect($("hotkey-notice").hidden).toBe(false);
    expect($("hotkey-notice").textContent).toContain("Ctrl+Alt+M is unavailable. Use Ctrl+Alt+Shift+M");
    expect($("mute-hotkey-label").textContent).toBe("Ctrl+Alt+Shift+M");
    await click("test-button");
    await hotkey("mute-hotkey");
    expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED", blocking: true });
    expect(overlay().detail).toContain("Press Ctrl+Alt+Shift+M to unmute");
    await hotkey("mute-hotkey");
    expect(overlay()).toMatchObject({ mode: "recording", blocking: false });
    // Pause remains functional after mute switches to a fallback.
    await hotkey("hotkey");
    expect(overlay()).toMatchObject({ title: "RECORDING PAUSED" });
  });

  it("keeps mute available when only pause registration fails", async () => {
    registered.pause = null;
    registered.warnings = ["Pause shortcut is in use"];
    await boot();
    expect($("hotkey-label").textContent).toBe("Unavailable");
    expect($("mute-hotkey-label").textContent).toBe("Ctrl+Alt+M");
    await click("test-button");
    await hotkey("mute-hotkey");
    expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED" });
  });

  it("keeps the button usable and gives accurate unmute instructions if both mute keys are taken", async () => {
    registered.mute = null;
    await boot();
    expect($("hotkey-notice").hidden).toBe(false);
    expect($("mute-hotkey-label").textContent).toBe("Use Mute my mic");
    await click("test-button");
    await click("mute-button");
    expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED", blocking: true });
    expect(overlay().detail).toContain("Click Unmute my mic in YanLearn Recorder");
    expect(overlay().detail).not.toContain("Press");
    await click("mute-button");
    expect(overlay()).toMatchObject({ mode: "recording", blocking: false });
  });

  it("shows a visible warning when the shortcut service fails", async () => {
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) => {
      if (command === "register_hotkeys") throw new Error("Shortcut service unavailable");
      return original(command, args);
    });
    await boot();
    expect($("hotkey-notice").textContent).toContain("Keyboard shortcuts are unavailable");
    expect($("hotkey-notice").hidden).toBe(false);
    await click("test-button");
    await click("mute-button");
    expect(overlay()).toMatchObject({ title: "MICROPHONE MUTED" });
  });
});
