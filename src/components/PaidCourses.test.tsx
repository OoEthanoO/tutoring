// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManageEnrollmentsMenu from "./ManageEnrollmentsMenu";
import CoursesMenu from "./CoursesMenu";
import PaidCoursesCard from "./PaidCoursesCard";

const auth = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/authClient", () => ({ getCurrentUser: auth.user, onAuthChange: () => () => {} }));
vi.mock("./Notification", () => ({ useNotification: () => ({ showNotification: vi.fn() }) }));

let root: Root, container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;
const calls = (method: string) => fetcher.mock.calls.filter(([, options]) => options?.method === method);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("reviewing an enrollment in a paid course", () => {
  const entry = (paymentConfirmedAt: string | null, isPaid = true) => ({
    id: "request", status: "pending", created_at: "2026-11-20T12:00:00.000Z",
    payment_confirmed_at: paymentConfirmedAt, student_name: "Applicant", student_email: "applicant@example.test",
    course: { id: "course", title: "Paid Coding", is_paid: isPaid, paid_fee: isPaid ? 60 : null },
  });
  const mount = async (request: ReturnType<typeof entry>) => {
    auth.user.mockResolvedValue({ id: "reviewer", email: "reviewer@example.test", role: "COO" });
    fetcher.mockImplementation(async () => Response.json({ requests: [request] }));
    await act(async () => root.render(<ManageEnrollmentsMenu />));
  };

  it("keeps Approve disabled until the tutor has marked the payment as received", async () => {
    await mount(entry(null));
    expect(container.textContent).toContain("Paid course · $60 to the tutor");
    expect(container.textContent).toContain("Waiting for the tutor to mark the payment as received");
    expect(button("Approve").disabled).toBe(true);
    // Rejecting never depends on the payment.
    expect(button("Reject").disabled).toBe(false);
    await act(async () => button("Approve").click());
    expect(calls("PATCH")).toHaveLength(0);
  });

  it("allows Approve once the payment is confirmed", async () => {
    await mount(entry("2026-11-20T15:00:00.000Z"));
    expect(container.textContent).toContain("The tutor marked the payment as received");
    expect(button("Approve").disabled).toBe(false);
  });

  it("leaves an ordinary course alone", async () => {
    await mount(entry(null, false));
    expect(container.textContent).not.toContain("Paid course");
    expect(button("Approve").disabled).toBe(false);
  });
});

describe("enrolling in a paid course", () => {
  const paidCourse = (paymentNote: string | null) => ({
    id: "paid", title: "Course paid", description: null, created_at: "2026-09-01T00:00:00Z",
    created_by_name: "Tutor", donation_link: null, donation_fee: null,
    is_paid: true, paid_fee: 49.5, payment_note: paymentNote,
    enrollment_status: null, max_students: 10, enrollment_count: 0,
    course_classes: [{ id: "class-paid", title: "Class 1", starts_at: "2099-10-01T12:00:00Z", duration_hours: 1, created_at: "2026-09-01T00:00:00Z" }],
  });
  const open = async (course: ReturnType<typeof paidCourse>) => {
    auth.user.mockResolvedValue({ id: "student", email: "student@example.test", role: "student" });
    fetcher.mockImplementation(async (_url, options) => options?.method === "POST"
      ? Response.json({ success: true }) : Response.json({ courses: [course] }));
    await act(async () => root.render(<CoursesMenu />));
    const title = [...container.querySelectorAll("p")].find((item) => item.textContent === "Course paid")!;
    await act(async () => title.click());
  };
  const submitButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  // The page has other checkboxes, so this one is found by its label.
  const paidTick = () =>
    [...document.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("I have sent the payment to the tutor"))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;

  it("shows the fee and the tutor's payment note, and unlocks the form only after the family says it has paid", async () => {
    await open(paidCourse("Interac e-Transfer to the tutor's address"));
    expect(document.body.textContent).toContain("Course Fee: $49.50, paid directly to the tutor");
    expect(document.body.textContent).toContain("Interac e-Transfer to the tutor's address");
    expect(document.body.textContent).toContain("not to YanLearn and not to SickKids");
    // A paid course never sends anyone to a donation page.
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Donation");
    expect(submitButton().disabled).toBe(true);

    await act(async () => paidTick()!.click());
    expect(submitButton().disabled).toBe(false);
  });

  it("stays closed while the tutor has no payment note", async () => {
    await open(paidCourse(null));
    expect(document.body.textContent).toContain("The tutor has not added payment details yet");
    expect(submitButton().disabled).toBe(true);
    expect(paidTick()).toBeNull();
  });
});

describe("the tutor's paid courses card", () => {
  const pending = {
    id: "11111111-1111-4111-8111-111111111111", courseId: "course", courseTitle: "Paid Coding", fee: 60,
    studentName: "Applicant", guardianName: "Guardian", submittedAt: "2026-11-20T12:00:00.000Z",
    paymentConfirmedAt: null,
  };
  const mount = async (profile: { seniorTutor: boolean; paymentNote?: string }) => {
    fetcher.mockImplementation(async (url, options) => {
      if (options?.method === "PATCH" && String(url) === "/api/paid-enrollments") {
        return Response.json({ request: { id: pending.id, paymentConfirmedAt: "2026-11-20T15:00:00.000Z" } });
      }
      if (String(url) === "/api/tutor-profile") return Response.json(profile);
      return Response.json({ requests: [pending] });
    });
    await act(async () => root.render(<PaidCoursesCard />));
  };

  it("shows nothing to a tutor who is not a senior tutor", async () => {
    await mount({ seniorTutor: false });
    expect(container.textContent).toBe("");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["/api/tutor-profile"]);
  });

  it("lists the payments to confirm and records the tutor's confirmation", async () => {
    await mount({ seniorTutor: true, paymentNote: "e-Transfer" });
    expect(container.textContent).toContain("Paid Coding · $60");
    expect(container.textContent).toContain("Parent or guardian: Guardian");
    await act(async () => button("Payment received").click());
    expect(calls("PATCH")).toHaveLength(1);
    expect(JSON.parse(String(calls("PATCH")[0][1]?.body))).toEqual({
      requestId: pending.id, received: true, submittedAt: pending.submittedAt,
    });
    expect(container.textContent).toContain("Management can now approve the enrollment");
    expect(button("Undo")).toBeDefined();
  });

  it("warns a senior tutor who has no payment note yet", async () => {
    await mount({ seniorTutor: true, paymentNote: "" });
    expect(container.textContent).toContain("cannot become a paid course until you have saved a payment note");
    expect(button("Save payment note").disabled).toBe(true);
  });
});
