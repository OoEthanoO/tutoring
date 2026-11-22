// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CourseFeedbackCard from "./CourseFeedbackCard";
import TutorCourseFeedbackCard from "./TutorCourseFeedbackCard";

/** The post-course feedback pages (COURSE_FEEDBACK.md), with the API faked. */

let root: Root, container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
const posts = () => fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const click = async (element: Element | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
};

const openForm = {
  courseId: "course", title: "Python - Beginner", tutorName: "Tutor", endedAt: "2026-11-12T23:00:00.000Z",
  closesAt: "2026-12-12T23:00:00.000Z", answers: null, declined: false, savedAt: null,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("the student's form", () => {
  it("sends only what was answered and then thanks the student", async () => {
    fetcher.mockResolvedValueOnce(reply({ forms: [openForm] }));
    await act(async () => root.render(<CourseFeedbackCard />));
    expect(container.textContent).toContain("How was Python - Beginner?");
    expect(container.textContent).toContain("without your name");

    await click(container.querySelectorAll("fieldset")[0].querySelectorAll("button")[4]); // course: 5
    await click(button("About right"));
    fetcher.mockResolvedValueOnce(reply({
      ok: true,
      form: { ...openForm, answers: { courseRating: 5, tutorRating: null, pace: "about_right", anotherCourse: null, nextCourse: null, comments: null }, savedAt: "now" },
    }));
    await click(button("Send"));

    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      courseId: "course", courseRating: 5, tutorRating: null, pace: "about_right",
      anotherCourse: null, nextCourse: null, comments: null,
    });
    expect(container.textContent).toContain("Thank you! Your answers are saved.");
    expect(container.textContent).toContain("Course: 5/5 · Pace: About right");
    expect(button("Change my answers")).toBeTruthy();
  });

  it("sends No thanks on its own and shows the server's refusal", async () => {
    fetcher.mockResolvedValueOnce(reply({ forms: [openForm] }));
    await act(async () => root.render(<CourseFeedbackCard />));
    fetcher.mockResolvedValueOnce(reply({ error: "The form for this course has closed." }, 409));
    await click(button("No thanks"));
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ courseId: "course", declined: true });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("has closed");
  });

  it("shows nothing when no form is open", async () => {
    fetcher.mockResolvedValueOnce(reply({ forms: [] }));
    await act(async () => root.render(<CourseFeedbackCard />));
    expect(container.textContent).toBe("");
  });
});

describe("the tutor's card", () => {
  it("says when an open form's answers will appear, and lists closed ones without names", async () => {
    fetcher.mockResolvedValueOnce(reply({ courses: [
      { courseId: "a", title: "Open course", endedAt: "2026-11-20T00:00:00Z", status: "open", closesAt: "2026-12-20T00:00:00Z", summary: null, answers: [] },
      { courseId: "b", title: "Closed course", endedAt: "2026-10-01T00:00:00Z", status: "closed", closesAt: "2026-10-31T00:00:00Z",
        summary: { responses: 1, declined: 0, courseRatingAverage: 4, courseRatingCount: 1, tutorRatingAverage: 5, tutorRatingCount: 1,
          pace: { too_slow: 0, about_right: 1, too_fast: 0 }, anotherCourse: { yes: 1, maybe: 0, no: 0 } },
        answers: [{ courseRating: 4, tutorRating: 5, pace: "about_right", anotherCourse: "yes", nextCourse: null, comments: "Fun" }] },
    ] }));
    await act(async () => root.render(<TutorCourseFeedbackCard />));
    expect(container.textContent).toContain("the answers appear here then");
    expect(container.textContent).toContain("1 answer · course 4/5 · tutor 5/5");
    await click(button("Show answers"));
    expect(container.textContent).toContain("“Fun”");
  });
});
