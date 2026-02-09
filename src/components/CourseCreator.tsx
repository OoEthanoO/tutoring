"use client";

import { useEffect, useRef, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole } from "@/lib/roles";

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function CourseCreator() {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftClassTitle, setDraftClassTitle] = useState("");
  const [draftClassStartsAt, setDraftClassStartsAt] = useState("");
  const [isCompletedCourse, setIsCompletedCourse] = useState(false);
  const [completedStartDate, setCompletedStartDate] = useState("");
  const [completedEndDate, setCompletedEndDate] = useState("");
  const [completedClassCount, setCompletedClassCount] = useState("1");
  const [draftClasses, setDraftClasses] = useState<
    { title: string; startsAt: string }[]
  >([]);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setCanCreate(false);
        setUserRole(null);
        return;
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null
      );
      setUserRole(resolvedRole);
      setCanCreate(canManageCourses(resolvedRole));
      if (resolvedRole !== "founder") {
        setIsCompletedCourse(false);
      }
    };

    load();

    return onAuthChange(load);
  }, []);


  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    if (!title.trim()) {
      setStatus({ type: "error", message: "Please add a title." });
      return;
    }

    if (isCompletedCourse) {
      const classCount = Number(completedClassCount);
      if (
        !completedStartDate ||
        !completedEndDate ||
        !Number.isFinite(classCount) ||
        classCount <= 0
      ) {
        setStatus({
          type: "error",
          message:
            "Completed courses require start date, end date, and number of classes.",
        });
        return;
      }
      if (
        new Date(completedEndDate).getTime() <
        new Date(completedStartDate).getTime()
      ) {
        setStatus({
          type: "error",
          message: "End date must be after start date.",
        });
        return;
      }
    }

    if (userRole === "tutor") {
      const ok = window.confirm(
        "This course will immediately become public. You will not be able to delete it unless you contact the admin (ethans.coding.class@gmail.com), but you can still edit it after creation. Do you want to continue?"
      );
      if (!ok) {
        return;
      }
    } else if (userRole === null) {
      const currentUser = await getCurrentUser();
      const currentRole = resolveUserRole(
        currentUser?.email ?? null,
        currentUser?.role ?? null
      );
      if (currentRole === "tutor") {
        const ok = window.confirm(
          "This course will immediately become public. You will not be able to delete it unless you contact the admin (ethans.coding.class@gmail.com), but you can still edit it after creation. Do you want to continue?"
        );
        if (!ok) {
          return;
        }
      }
    }

    setIsSubmitting(true);
    const response = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: isCompletedCourse ? "" : description.trim(),
        isCompleted: isCompletedCourse,
        completedStartDate: isCompletedCourse ? completedStartDate : undefined,
        completedEndDate: isCompletedCourse ? completedEndDate : undefined,
        completedClassCount: isCompletedCourse
          ? Number(completedClassCount)
          : undefined,
        classes: isCompletedCourse
          ? []
          : draftClasses.map((item) => ({
              title: item.title,
              startsAt: new Date(item.startsAt).toISOString(),
            })),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to create course.",
      });
      setIsSubmitting(false);
      return;
    }

    await response.json().catch(() => null);
    setTitle("");
    setDescription("");
    setDraftClassTitle("");
    setDraftClassStartsAt("");
    setDescription("");
    if (userRole !== "founder" || !isCompletedCourse) {
      setIsCompletedCourse(false);
    }
    setCompletedStartDate("");
    setCompletedEndDate("");
    setCompletedClassCount("1");
    setDraftClasses([]);
    setStatus({ type: "success", message: "Course created." });
    setIsSubmitting(false);

    if (userRole === "founder" && isCompletedCourse) {
      titleInputRef.current?.focus();
    }
  };


  const addDraftClass = () => {
    setStatus({ type: "idle", message: "" });

    const titleValue = draftClassTitle.trim();
    const startsAtValue = draftClassStartsAt;

    if (!titleValue) {
      setStatus({ type: "error", message: "Class title is required." });
      return;
    }

    if (!startsAtValue) {
      setStatus({ type: "error", message: "Class date/time is required." });
      return;
    }

    const nextEntry = {
      title: titleValue,
      startsAt: startsAtValue,
    };
    const updatedDrafts = [...draftClasses, nextEntry];

    setDraftClasses((current) => [...current, nextEntry]);

    const nextDraftStart = getSuggestedStartValueFromDraft(updatedDrafts);

    setDraftClassTitle("");
    setDraftClassStartsAt(nextDraftStart);
  };

  const removeDraftClass = (index: number) => {
    setDraftClasses((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  };

  const getSuggestedStartValueFromDraft = (
    classes: { title: string; startsAt: string }[]
  ) => {
    if (classes.length < 2) {
      return "";
    }

    const sorted = [...classes].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];
    const gap =
      new Date(latest.startsAt).getTime() -
      new Date(previous.startsAt).getTime();
    if (!Number.isFinite(gap) || gap <= 0) {
      return "";
    }

    const suggested = new Date(new Date(latest.startsAt).getTime() + gap);
    return toLocalDateTimeInputValue(suggested);
  };

  const toLocalDateTimeInputValue = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };


  if (!canCreate) {
    return null;
  }

  return (
    <section className="space-y-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Create
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Create a new course
        </h2>
      </header>

      {status.type !== "idle" ? (
        <div
          className={
            status.type === "error"
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
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
        {!isCompletedCourse ? (
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
          </div>
        ) : null}
        {userRole === "founder" ? (
          <div className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-4">
            <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={isCompletedCourse}
                onChange={(event) => setIsCompletedCourse(event.target.checked)}
              />
              Create as completed course
            </label>
            {isCompletedCourse ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={completedStartDate}
                    onChange={(event) => setCompletedStartDate(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    required={isCompletedCourse}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    End date
                  </label>
                  <input
                    type="date"
                    value={completedEndDate}
                    onChange={(event) => setCompletedEndDate(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    required={isCompletedCourse}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Number of classes
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={completedClassCount}
                    onChange={(event) => setCompletedClassCount(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    required={isCompletedCourse}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {!isCompletedCourse ? (
          <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Classes (Optional)
              </p>
              <p className="text-xs text-[var(--muted)]">
                Add classes now or later.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
              <div className="space-y-1">
                <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Class title
                </label>
                <input
                  type="text"
                  placeholder="Class title"
                  value={draftClassTitle}
                  onChange={(event) => setDraftClassTitle(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Date &amp; time
                </label>
                <input
                  type="datetime-local"
                  value={draftClassStartsAt}
                  onChange={(event) => setDraftClassStartsAt(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                />
              </div>
              <button
                type="button"
                onClick={addDraftClass}
                className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] sm:col-span-4"
              >
                Add class
              </button>
            </div>
            {draftClasses.length ? (
              <ul className="space-y-2 text-xs text-[var(--muted)]">
                {draftClasses.map((draftClass, index) => (
                  <li
                    key={`${draftClass.title}-${draftClass.startsAt}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <span>
                      {draftClass.title} ·{" "}
                      {new Date(draftClass.startsAt).toLocaleString()} · 1 hr
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDraftClass(index)}
                      className="text-xs font-semibold text-[var(--foreground)] transition hover:text-red-500"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full border border-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Creating..." : "Create course"}
        </button>
      </form>

    </section>
  );
}
