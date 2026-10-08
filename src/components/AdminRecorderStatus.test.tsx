// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRecorderStatus from "./AdminRecorderStatus";

let root: Root, container: HTMLDivElement;
const now = Date.now();
const device = (overrides: Record<string, unknown>) => ({
  deviceName: "Laptop", platform: "macos", appVersion: "0.5.5", stateLabel: "Idle", connected: true,
  lastSeenAt: new Date(now - 5000).toISOString(), currentClassTitle: null, outdated: false, ...overrides,
});
const payload = {
  latestVersion: "0.5.5",
  generatedAt: new Date(now).toISOString(),
  tutorCount: 3,
  connectedCount: 1,
  tutors: [
    { tutorId: "a", name: "Jaden Fu", email: "jaden@example.test", connected: true, outdated: false,
      lastSeenAt: new Date(now - 5000).toISOString(),
      devices: [device({ stateLabel: "Recording", currentClassTitle: "Python - Beginner — Class 2" })] },
    { tutorId: "b", name: "Ann Lee", email: "ann@example.test", connected: false, outdated: true,
      lastSeenAt: new Date(now - 3 * 3600_000).toISOString(),
      devices: [device({ connected: false, appVersion: "0.5.3", outdated: true, platform: "windows", lastSeenAt: new Date(now - 3 * 3600_000).toISOString() })] },
    { tutorId: "c", name: "Bo Chen", email: "bo@example.test", connected: false, outdated: false, lastSeenAt: null, devices: [] },
  ],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const mount = async () => { await act(async () => root.render(<AdminRecorderStatus />)); };
const click = async (text: string) => { await act(async () => {
  [...container.querySelectorAll("button")].find(button => button.textContent === text)!.click();
}); };

describe("AdminRecorderStatus", () => {
  it("shows who is connected, what they are doing, and the version they are on", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("1 of 3 tutors connected");
    expect(text).toContain("Latest release: 0.5.5");
    expect(text).toContain("Recording — Python - Beginner — Class 2");
    expect(text).toContain("v0.5.5");
    expect(text).toContain("v0.5.3 · older than the latest");
    expect(text).toContain("Not connected · last seen 3 h ago");
    expect(text).toContain("Never signed in");
  });

  it("filters to tutors on an older version", async () => {
    await mount();
    await click("Older version");
    const text = container.textContent ?? "";
    expect(text).toContain("Ann Lee");
    expect(text).not.toContain("Jaden Fu");
    expect(text).not.toContain("Bo Chen");
  });

  it("says so when the status cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 403 })));
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Unauthorized");
  });

  it("dates an old class session instead of implying current Discord attendance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...payload, tutors: [{
      ...payload.tutors[0], devices: [device({ stateLabel: "Not recording — reason not reported",
        currentClassTitle: "Math — Class 3", currentClassStartsAt: "2026-01-01T00:00:00Z",
        currentClassEndsAt: "2026-01-01T01:00:00Z" })],
    }] })));
    await mount();
    expect(container.textContent).toContain("Not recording — reason not reported — Math — Class 3");
    expect(container.textContent).toContain("past scheduled end");
    expect(container.textContent).not.toContain("In class, not recording");
  });
});
