// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecorderDiagnosticsPanel from "./RecorderDiagnosticsPanel";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ receivedAt: null, report: null })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const open = async () => {
  await act(async () => root.render(<RecorderDiagnosticsPanel tutorId="tutor" deviceId="computer" />));
  await act(async () => {
    const details = container.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
};
describe("remote diagnostic viewer", () => {
  it("fetches only after expansion and explains missing reports on older versions", async () => {
    await act(async () => root.render(<RecorderDiagnosticsPanel tutorId="tutor" deviceId="computer" />));
    expect(fetch).not.toHaveBeenCalled();
    await open();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("tutorId=tutor&deviceId=computer"), expect.anything());
    expect(container.textContent).toContain("older versions cannot send past logs remotely");
  });
  it("shows actual reported errors and renders logs only as text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ receivedAt: "2026-10-08T01:00:00Z", report: {
      state: "capture_failed", inCall: true, capturing: false, captureFailures: 6, segmentCount: 2, pendingUploads: 0,
      logs: [{ at: "2026-10-08T01:00:00Z", message: '<img src=x onerror="alert(1)"> Capture failed' }],
    } })));
    await open();
    expect(container.textContent).toContain("capture failed");
    expect(container.textContent).toContain("Capture failures: 6");
    expect(container.querySelector("pre")?.textContent).toContain("<img");
    expect(container.querySelector("img")).toBeNull();
  });
});
