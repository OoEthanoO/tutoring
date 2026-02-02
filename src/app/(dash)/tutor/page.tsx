const tutorActions = [
  "Create and publish courses",
  "Post weekly updates for students",
  "Review enrollment requests",
  "Message students inside a course",
];

export default function TutorPage() {
  return (
    <div className="grid gap-8">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Tutor
        </p>
        <h1 className="text-3xl font-semibold text-[var(--foreground)]">
          Course workspace
        </h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Manage your courses, publish updates, and connect with students.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {tutorActions.map((item) => (
          <div
            key={item}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]"
          >
            {item}
          </div>
        ))}
      </section>
    </div>
  );
}
