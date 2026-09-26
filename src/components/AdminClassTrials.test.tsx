// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminClassTrials from "./AdminClassTrials";

let root: Root, container: HTMLDivElement;
let requests: { method: string; body: Record<string, unknown> }[];
let failSave: boolean;
const lesson = { id: "class", title: "Class 1", course_id: "course", starts_at: new Date(Date.now() + 3600_000).toISOString(), duration_hours: 1,
  course: { id: "course", title: "Grade 6 French", is_completed: false, deleted_at: null } };
const trial = { id: "trial", class_id: "class", discord_user_id: "123456789012345678", student_name: "Trial Student", lesson, created_at: new Date().toISOString(), revoked_at: null };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); requests = []; failSave = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method) {
      requests.push({ method: init.method, body: JSON.parse(String(init.body)) });
      return failSave ? Response.json({ error: "Confirm replacement of the existing approval." }, { status: 409 }) : Response.json({ success: true });
    }
    return Response.json({ classes: [lesson], trials: [trial, { ...trial, id: "revoked", student_name: "Revoked Student", revoked_at: new Date().toISOString() }] });
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const mount = async () => { await act(async () => root.render(<AdminClassTrials />)); };
const fill = async (label: string, value: string) => { await act(async () => {
  const field = container.querySelector(`[aria-label="${label}"]`)!;
  const proto = field.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}); };

describe("trial booking interface", () => {
  it("submits one selected class, own name and Discord ID with conversion off by default", async () => {
    await mount();
    await fill("Scheduled class", "class"); await fill("Student name", "New Student"); await fill("Discord user ID", "987654321098765432");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(requests[0]).toEqual({ method: "POST", body: { classId: "class", studentName: "New Student", discordUserId: "987654321098765432", replaceApprovedAccount: false } });
    expect(container.textContent).toContain("Trial saved");
  });
  it("shows booking errors and makes replacing an approval an explicit choice", async () => {
    failSave = true; await mount();
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(requests[0].body.replaceApprovedAccount).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Confirm replacement");
  });
  it("revokes a booking by trial ID and lets staff inspect history", async () => {
    await mount();
    expect(container.textContent).not.toContain("Revoked Student");
    await act(async () => { [...container.querySelectorAll("button")].find(b => b.textContent === "Revoke trial")!.click(); });
    expect(requests[0]).toEqual({ method: "DELETE", body: { id: "trial" } });
    await act(async () => { container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click(); });
    expect(container.textContent).toContain("Revoked Student");
  });
});
