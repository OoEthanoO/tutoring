// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadmeMenu from "./ReadmeMenu";

let root: Root, container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ReadmeMenu />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("ReadmeMenu", () => {
  it("covers the class tools tutors use, not just the old #readme rules", () => {
    const headings = [...container.querySelectorAll("h3")].map(heading => heading.textContent);
    for (const title of ["Course requests", "Before class", "During class", "Breakout rooms", "Zen mode",
      "In-class exercises", "YanLearn Recorder", "Trial students", "Community service hours", "Strike system"]) {
      expect(headings).toContain(title);
    }
  });

  it("only links to sections that exist on the page", () => {
    const anchors = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(anchors.length).toBeGreaterThan(10);
    for (const anchor of anchors) {
      expect(container.querySelector(anchor.getAttribute("href")!), anchor.getAttribute("href")!).not.toBeNull();
    }
  });

  it("lists every section in the contents", () => {
    const listed = container.querySelectorAll('nav[aria-label="Readme contents"] a').length;
    expect(listed).toBe(container.querySelectorAll("article").length);
  });
});
