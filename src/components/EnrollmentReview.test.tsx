// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManageEnrollmentsMenu from "./ManageEnrollmentsMenu";
import StudentApplicationForm from "./StudentApplicationForm";
import CoursesMenu from "./CoursesMenu";
import { enrollmentBlocksApplication } from "@/lib/enrollmentRequests";

const auth = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/authClient", () => ({ getCurrentUser: auth.user, onAuthChange: () => () => {} }));
vi.mock("./Notification", () => ({ useNotification: () => ({ showNotification: vi.fn() }) }));
let root: Root, container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const entry = { id: "request", status: "pending", created_at: "2026-09-10T12:00:00.000Z", student_name: "Applicant", student_email: "applicant@example.test", course: { id: "course", title: "Coding" } };
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const mount = async () => { await act(async () => root.render(<ManageEnrollmentsMenu />)); };
const fillReason = async (value: string) => {
  await act(async () => {
    const textarea = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submitReason = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
const mutations = () => fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.user.mockResolvedValue({ id: "reviewer", email: "reviewer@example.test", role: "COO Shadow" });
  fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "PATCH") {
      const body = JSON.parse(String(options.body));
      return Response.json({ request: { status: "rejected", rejection_reason: body.rejectionReason }, emailSent: true });
    }
    return Response.json({ requests: [entry] });
  });
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("enrollment rejection interface", () => {
  it("requires a reason, explains the email, and renders the saved reason as text", async () => {
    await mount(); await click("Reject");
    expect(button("Reject and email reason").disabled).toBe(true);
    expect(container.textContent).toContain("This reason will be emailed to the applicant");
    await fillReason("  \n  "); expect(button("Reject and email reason").disabled).toBe(true);
    expect(mutations()).toHaveLength(0);
    const reason = "Correct <img src=x>\n    Then reapply.";
    await fillReason(`  ${reason}  `); await submitReason();
    expect(mutations()).toHaveLength(1);
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ action: "reject", rejectionReason: reason, submittedAt: entry.created_at });
    expect(container.textContent).toContain("The reason has been emailed to the applicant");
    expect(container.textContent).toContain(reason);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });
  it("allows cancelling without rejecting or sending anything", async () => {
    await mount(); await click("Reject"); await fillReason("A draft reason"); await click("Cancel");
    expect(container.querySelector("textarea")).toBeNull(); expect(mutations()).toHaveLength(0);
  });
  it("keeps the draft reason available after a network failure", async () => {
    await mount(); await click("Reject"); await fillReason("Try again later");
    fetcher.mockRejectedValueOnce(new Error("Offline"));
    await submitReason();
    expect(container.textContent).toContain("Offline");
    expect(container.querySelector("textarea")?.value).toBe("Try again later");
    expect(button("Reject and email reason").disabled).toBe(false);
  });
  it("reports an email failure without losing the saved rejection", async () => {
    await mount(); await click("Reject"); await fillReason("Please correct your grade");
    fetcher.mockResolvedValueOnce(Response.json({ request: { status: "rejected", rejection_reason: "Please correct your grade" }, emailSent: false }));
    await submitReason();
    expect(container.textContent).toContain("Enrollment rejected and reason saved, but the email could not be sent");
    expect(container.textContent).toContain("Reason: Please correct your grade");
  });
  it("does not show management controls to ordinary tutors", async () => {
    auth.user.mockResolvedValue({ id: "tutor", email: "tutor@example.test", role: "executive" });
    await mount(); expect(container.textContent).toBe(""); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("re-enrollment form", () => {
  it("opens an editable application with an enabled re-enroll button after rejection", async () => {
    await act(async () => root.render(<StudentApplicationForm enrollmentStatus="rejected"
      isEnrolled={enrollmentBlocksApplication("rejected")} isConfirmDisabled={enrollmentBlocksApplication("rejected")}
      isSubmitting={false} onSubmit={vi.fn()} />));
    expect(container.querySelectorAll("input,select").length).toBeGreaterThan(0);
    expect(button("Re-enroll in this course").disabled).toBe(false);
  });
  it.each(["pending", "approved", "enrolled"])("keeps %s requests blocked", async status => {
    await act(async () => root.render(<StudentApplicationForm enrollmentStatus={status}
      isEnrolled={enrollmentBlocksApplication(status)} isConfirmDisabled={enrollmentBlocksApplication(status)}
      isSubmitting={false} onSubmit={vi.fn()} />));
    expect(container.querySelectorAll("input,select")).toHaveLength(0);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
  it("continues showing Course Full for a rejected student when no places remain", async () => {
    await act(async () => root.render(<StudentApplicationForm enrollmentStatus="rejected" isFull isConfirmDisabled isSubmitting={false} onSubmit={vi.fn()} />));
    expect(button("Course Full").disabled).toBe(true);
  });
});

describe("course donation link requirement", () => {
  const makeCourse = (id: string, donationLink: string | null, status: string | null = null) => ({
    id, title: `Course ${id}`, description: null, created_at: "2026-09-01T00:00:00Z",
    created_by_name: "Tutor", donation_link: donationLink, donation_fee: null,
    enrollment_status: status, max_students: 10, enrollment_count: 0,
    course_classes: [{ id: `class-${id}`, title: "Class 1", starts_at: "2099-10-01T12:00:00Z", duration_hours: 1, created_at: "2026-09-01T00:00:00Z" }],
  });
  const mountCourses = async (courses: ReturnType<typeof makeCourse>[]) => {
    auth.user.mockResolvedValue({ id: "student", email: "student@example.test", role: "student" });
    fetcher.mockImplementation(async (_url, options) => options?.method === "POST"
      ? Response.json({ success: true }) : Response.json({ courses }));
    await act(async () => root.render(<CoursesMenu />));
  };
  const openCourse = async (id: string) => {
    const title = [...container.querySelectorAll("p")].find(item => item.textContent === `Course ${id}`)!;
    await act(async () => title.click());
  };
  const submitButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const submitApplication = async () => {
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  };
  const openDonation = async (middleClick = false) => {
    const link = document.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
    expect(link.href).toMatch(/^https:\/\/donate\.example\.test\//);
    // Exercise the link handler without navigating to an external donation service.
    link.addEventListener(middleClick ? "auxclick" : "click", event => event.preventDefault(), { once: true });
    await act(async () => { link.dispatchEvent(new MouseEvent(middleClick ? "auxclick" : "click", {
      bubbles: true, cancelable: true, button: middleClick ? 1 : 0,
    })); });
  };
  const enrollmentPosts = () => fetcher.mock.calls.filter(([, options]) => options?.method === "POST");

  it.each([null, "rejected"])("blocks a %s application until its donation link is opened", async status => {
    await mountCourses([makeCourse("one", "https://donate.example.test/one", status)]);
    await openCourse("one");
    expect(submitButton().disabled).toBe(true);
    await submitApplication();
    expect(enrollmentPosts()).toHaveLength(0);
    await openDonation();
    expect(submitButton().disabled).toBe(false);
    expect(document.body.textContent).toContain("Donation Link Opened");
    await act(async () => {
      for (const input of document.querySelectorAll<HTMLInputElement>("form input")) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input,
          input.type === "email" ? "guardian@example.test" : "Example");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await submitApplication();
    expect(enrollmentPosts()).toHaveLength(1);
    expect(enrollmentPosts()[0][0]).toBe("/api/courses/one/enroll");
  });

  it("requires a fresh opening after closing the form or choosing a different course", async () => {
    await mountCourses([makeCourse("one", "https://donate.example.test/one"), makeCourse("two", "https://donate.example.test/two")]);
    await openCourse("one"); await openDonation(true);
    expect(submitButton().disabled).toBe(false);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close modal"]')!.click());
    await openCourse("one");
    expect(submitButton().disabled).toBe(true);
    await openDonation();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close modal"]')!.click());
    await openCourse("two");
    expect(submitButton().disabled).toBe(true);
  });

  it("allows enrollment without opening a link when the course has none", async () => {
    await mountCourses([makeCourse("free", null)]); await openCourse("free");
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });
});
