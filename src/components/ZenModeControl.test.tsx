// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ZenModeControl from "./ZenModeControl";
let root: Root, container: HTMLDivElement, enabled: boolean;
let bodies: unknown[], problems: string[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); enabled = false; bodies = []; problems = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { const data = JSON.parse(String(init.body)); bodies.push(data); enabled = data.enabled; }
    return Response.json({ enabled, problems });
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<ZenModeControl courseId="course" courseTitle="French" />));
it("toggles the course preference on and off mid-class with visible status", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(bodies).toEqual([{ enabled: true }]);
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("current and remaining classes");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(bodies).toEqual([{ enabled: true }, { enabled: false }]);
});
it("shows when the preference saved but Discord needs a retry", async () => {
  problems = ["Missing Permissions"]; await mount();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("not fully applied");
});
