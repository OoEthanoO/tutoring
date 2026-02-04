"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole } from "@/lib/roles";

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function CourseCreator() {
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
  const [draftClassDuration, setDraftClassDuration] = useState("1");
  const [draftClasses, setDraftClasses] = useState<
    { title: string; startsAt: string; durationHours: number }[]
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

    if (userRole === "tutor") {
      const ok = window.confirm(
        "This course will immediately become public and you will not be able to delete it unless you contact the admin (ethans.coding.class@gmail.com). Do you want to continue?"
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
          "This course will immediately become public and you will not be able to delete it unless you contact the admin (ethans.coding.class@gmail.com). Do you want to continue?"
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
        description: description.trim(),
        classes: draftClasses.map((item) => ({
          title: item.title,
          startsAt: new Date(item.startsAt).toISOString(),
          durationHours: item.durationHours,
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
    setDraftClasses([]);
    setStatus({ type: "success", message: "Course created." });
    setIsSubmitting(false);
  };


  const addDraftClass = () => {
    setStatus({ type: "idle", message: "" });

    const titleValue = draftClassTitle.trim();
    const startsAtValue = draftClassStartsAt;
    const durationValue = Number(draftClassDuration);

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
      durationHours: durationValue > 0 ? durationValue : 1,
    };
    const updatedDrafts = [...draftClasses, nextEntry];

    setDraftClasses((current) => [...current, nextEntry]);

    const nextDraftStart = getSuggestedStartValueFromDraft(updatedDrafts);
    const nextDraftDuration = getSuggestedDurationFromDraft(updatedDrafts);

    setDraftClassTitle("");
    setDraftClassStartsAt(nextDraftStart);
    setDraftClassDuration(nextDraftDuration || "1");
  };

  const removeDraftClass = (index: number) => {
    setDraftClasses((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  };

  const getSuggestedStartValueFromDraft = (
    classes: { title: string; startsAt: string; durationHours: number }[]
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

  const getSuggestedDurationFromDraft = (
    classes: { title: string; startsAt: string; durationHours: number }[]
  ) => {
    if (classes.length === 0) {
      return "1";
    }

    const sorted = [...classes].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    const latest = sorted[sorted.length - 1];
    return String(latest.durationHours || 1);
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
        </div>
        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] px-4 py-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Classes (Optional)
            </p>
            <p className="text-xs text-[var(--muted)]">
              Add classes now or later.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.7fr_auto]">
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
            <div className="space-y-1">
              <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Duration (hrs)
              </label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={draftClassDuration}
                onChange={(event) => setDraftClassDuration(event.target.value)}
                placeholder="Duration (hrs)"
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
                      {new Date(draftClass.startsAt).toLocaleString()} ·{" "}
                      {draftClass.durationHours} hrs
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
