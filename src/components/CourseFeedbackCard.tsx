"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANOTHER_COURSE_OPTIONS,
  MAX_COMMENTS_LENGTH,
  MAX_NEXT_COURSE_LENGTH,
  PACE_OPTIONS,
  type AnotherCourse,
  type FeedbackAnswers,
  type Pace,
} from "@/lib/courseFeedback";
import { FeedbackAnswersView, formatFeedbackDate } from "@/components/CourseFeedbackAnswers";

type FeedbackForm = {
  courseId: string;
  title: string;
  tutorName: string | null;
  endedAt: string;
  closesAt: string;
  answers: FeedbackAnswers | null;
  declined: boolean;
  savedAt: string | null;
};

const emptyAnswers: FeedbackAnswers = {
  courseRating: null, tutorRating: null, pace: null, anotherCourse: null, nextCourse: null, comments: null,
};

const chip = (selected: boolean) =>
  selected
    ? "rounded-full border border-[var(--foreground)] bg-[var(--foreground)] px-3 py-1 text-xs font-semibold text-[var(--surface)]"
    : "rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]";

function RatingPicker({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-[var(--foreground)]">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {[1, 2, 3, 4, 5].map((number) => (
          <button
            key={number}
            type="button"
            aria-pressed={value === number}
            onClick={() => onChange(value === number ? null : number)}
            className={chip(value === number)}
          >
            {number}
          </button>
        ))}
        <span className="text-[11px] text-[var(--muted)]">1 = poor, 5 = excellent</span>
      </div>
    </fieldset>
  );
}

function ChoicePicker<T extends string>({
  label, options, value, onChange,
}: { label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (value: T | null) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-[var(--foreground)]">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(value === option.value ? null : option.value)}
            className={chip(value === option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The optional feedback form for each course the student finished in the
 * last 30 days (COURSE_FEEDBACK.md). Renders nothing when there is none.
 */
export default function CourseFeedbackCard() {
  const [forms, setForms] = useState<FeedbackForm[]>([]);
  const [drafts, setDrafts] = useState<Record<string, FeedbackAnswers>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/course-feedback");
      if (!response.ok) return;
      const data = (await response.json()) as { forms?: FeedbackForm[] };
      setForms(data.forms ?? []);
    } catch {
      // The forms are offered again the next time the page is opened.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const draftFor = (form: FeedbackForm) => drafts[form.courseId] ?? form.answers ?? emptyAnswers;
  const setDraft = (courseId: string, patch: Partial<FeedbackAnswers>, base: FeedbackAnswers) =>
    setDrafts((current) => ({ ...current, [courseId]: { ...(current[courseId] ?? base), ...patch } }));

  const submit = async (form: FeedbackForm, declined: boolean) => {
    setBusyCourseId(form.courseId);
    setErrors((current) => ({ ...current, [form.courseId]: "" }));
    try {
      const response = await fetch("/api/course-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(declined ? { courseId: form.courseId, declined: true } : { courseId: form.courseId, ...draftFor(form) }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; form?: FeedbackForm | null } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Could not save your answers.");
      }
      if (data?.form) {
        const saved = data.form;
        setForms((current) => current.map((item) => (item.courseId === saved.courseId ? saved : item)));
      } else {
        await load();
      }
      setEditing((current) => ({ ...current, [form.courseId]: false }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[form.courseId];
        return next;
      });
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [form.courseId]: error instanceof Error ? error.message : "Could not save your answers.",
      }));
    } finally {
      setBusyCourseId(null);
    }
  };

  if (forms.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {forms.map((form) => {
        const isBusy = busyCourseId === form.courseId;
        const answered = Boolean(form.answers) || form.declined;
        const showForm = !answered || editing[form.courseId];
        const draft = draftFor(form);
        const until = formatFeedbackDate(form.closesAt);
        return (
          <div
            key={form.courseId}
            className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
          >
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--foreground)]">How was {form.title}?</p>
              <p className="text-xs text-[var(--muted)]">
                Optional, about two minutes, open until {until}. Every question is optional. Your
                tutor sees your answers without your name; YanLearn&apos;s leadership sees your name.
              </p>
            </div>

            {errors[form.courseId] ? (
              <p role="alert" className="text-xs text-red-500">{errors[form.courseId]}</p>
            ) : null}

            {!showForm ? (
              <div className="space-y-2">
                {form.declined ? (
                  <p className="text-xs text-[var(--foreground)]">You chose not to answer.</p>
                ) : (
                  <>
                    <p role="status" className="text-xs text-emerald-600">Thank you! Your answers are saved.</p>
                    {form.answers ? <FeedbackAnswersView answers={form.answers} /> : null}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setEditing((current) => ({ ...current, [form.courseId]: true }))}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                >
                  {form.declined ? "Answer after all" : "Change my answers"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <RatingPicker
                  label="How was the course?"
                  value={draft.courseRating}
                  onChange={(value) => setDraft(form.courseId, { courseRating: value }, draft)}
                />
                <RatingPicker
                  label={form.tutorName ? `How was your tutor, ${form.tutorName}?` : "How was your tutor?"}
                  value={draft.tutorRating}
                  onChange={(value) => setDraft(form.courseId, { tutorRating: value }, draft)}
                />
                <ChoicePicker<Pace>
                  label="The pace was"
                  options={PACE_OPTIONS}
                  value={draft.pace}
                  onChange={(value) => setDraft(form.courseId, { pace: value }, draft)}
                />
                <ChoicePicker<AnotherCourse>
                  label="Would you take another YanLearn course?"
                  options={ANOTHER_COURSE_OPTIONS}
                  value={draft.anotherCourse}
                  onChange={(value) => setDraft(form.courseId, { anotherCourse: value }, draft)}
                />
                <div className="space-y-1">
                  <label htmlFor={`feedback-next-${form.courseId}`} className="text-xs font-semibold text-[var(--foreground)]">
                    Which course would you like to take next?
                  </label>
                  <input
                    id={`feedback-next-${form.courseId}`}
                    value={draft.nextCourse ?? ""}
                    maxLength={MAX_NEXT_COURSE_LENGTH}
                    onChange={(event) => setDraft(form.courseId, { nextCourse: event.target.value }, draft)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`feedback-comments-${form.courseId}`} className="text-xs font-semibold text-[var(--foreground)]">
                    Anything else you would like to tell us?
                  </label>
                  <textarea
                    id={`feedback-comments-${form.courseId}`}
                    value={draft.comments ?? ""}
                    rows={3}
                    maxLength={MAX_COMMENTS_LENGTH}
                    onChange={(event) => setDraft(form.courseId, { comments: event.target.value }, draft)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => submit(form, false)}
                    className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? "Saving..." : "Send"}
                  </button>
                  {!form.declined ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => submit(form, true)}
                      className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      No thanks
                    </button>
                  ) : null}
                  {answered ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setEditing((current) => ({ ...current, [form.courseId]: false }))}
                      className="text-xs font-semibold text-[var(--muted)] underline underline-offset-2"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
