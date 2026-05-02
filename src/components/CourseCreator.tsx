"use client";

import { useEffect, useRef, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole } from "@/lib/roles";

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function CourseCreator() {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeframes, setTimeframes] = useState<Record<string, string>>({});
  const [frequency, setFrequency] = useState("");
  const [totalClasses, setTotalClasses] = useState<number>(1);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState("");

  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setCanCreate(false);
        return;
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null
      );
      setCanCreate(canManageCourses(resolvedRole));
    };

    load();

    return onAuthChange(load);
  }, []);

  const handleTimeframeChange = (day: string, value: string) => {
    setTimeframes(prev => ({ ...prev, [day]: value }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    if (!title.trim()) {
      setStatus({ type: "error", message: "Please add a title." });
      return;
    }

    setShowConfirmModal(true);
  };

  const proceedWithSubmission = async () => {
    setShowConfirmModal(false);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/course-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          timeframes,
          frequency: frequency.trim(),
          totalClasses,
          startDate,
          notes: notes.trim()
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to submit course request.",
        });
        setIsSubmitting(false);
        return;
      }

      await response.json().catch(() => null);
      setTitle("");
      setDescription("");
      setTimeframes({});
      setFrequency("");
      setTotalClasses(1);
      setStartDate(new Date().toISOString().split('T')[0]);
      setNotes("");
      setStatus({ type: "success", message: "Course request submitted successfully." });
    } catch (err) {
      setStatus({ type: "error", message: "An unexpected error occurred." });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canCreate) {
    return null;
  }

  return (
    <section className="relative">
      <div className="space-y-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Submit Request
          </p>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Submit a course creation request
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Your request will be reviewed by founders before being added to the catalog.
          </p>
        </header>

        {status.type !== "idle" ? (
          <div
            className={
              status.type === "error"
                ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
                : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
            }
          >
            {status.message}
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Title
            </label>
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Intro to Python"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Description
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What students will learn, projects, and outcomes."
              rows={4}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">Markdown is supported for formatting</p>
          </div>

          <div className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Available Timeframes
              </p>
              <p className="text-xs text-[var(--muted)]">
                Enter the set of time intervals you are available to teach for each day. Separate multiple intervals with commas (e.g. "9:30am-11am, 3pm-5pm"). Partial hours are allowed. Leave blank if you are not available on that day.
              </p>
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Tip: The wider your available timeframes are, the higher the chance to have more students. Please put your full availability.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {DAYS_OF_WEEK.map(day => (
                <div key={day} className="space-y-1">
                  <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    {day}
                  </label>
                  <input
                    type="text"
                    value={timeframes[day] || ""}
                    onChange={(e) => handleTimeframeChange(day, e.target.value)}
                    placeholder="e.g. 9am-11am, 3pm-5pm (leave blank for no availability)"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Frequency
            </label>
            <input
              type="text"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
              placeholder="e.g. Weekly, Twice per week"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Total Number of Classes
            </label>
            <input
              type="number"
              min={1}
              value={totalClasses}
              onChange={(event) => setTotalClasses(parseInt(event.target.value) || 1)}
              placeholder="e.g. 8"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              required
            />
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">Specify exactly how many classes this course should consist of.</p>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Proposed Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              required
            />
            <p className="px-1 mt-1 text-xs text-[var(--muted)]">What is your earliest start date for teaching this course?</p>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Notes for Founders (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Any additional information you want the founders to know."
              rows={3}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full border border-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Submitting..." : "Submit course request"}
          </button>
        </form>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md animate-in fade-in zoom-in duration-200 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">Important Confirmation</h3>
            <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
              Please make sure that the course length (number of classes) is long enough to covering all topics, because extending the course after submitting this request is very unlikely. This is especially important if this course involves a grade-specific curriculum, as you must cover all topics in this curriculum.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)] transition"
              >
                Go back
              </button>
              <button
                onClick={proceedWithSubmission}
                className="rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] hover:opacity-90 transition"
              >
                I'm sure, submit request
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
