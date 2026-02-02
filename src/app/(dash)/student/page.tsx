const studentSteps = [
  "Browse available courses",
  "Submit enrollment request",
  "Receive pending approval email",
  "Get accepted/declined confirmation",
];

export default function StudentPage() {
  return (
    <div className="grid gap-8">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Student
        </p>
        <h1 className="text-3xl font-semibold text-[var(--foreground)]">
          Enrollment hub
        </h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Track your enrollment requests and upcoming sessions.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {studentSteps.map((item) => (
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
