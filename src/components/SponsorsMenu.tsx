"use client";

export default function SponsorsMenu() {
  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Sponsorship
        </p>
      </header>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Our Mission
        </h3>
        <p className="text-sm text-[var(--muted)]">
          YanLearn is a platform built by high school students, for students. We
          bring together talented high schoolers across the Toronto area and give
          them a stage to share their academic strengths — providing high-quality
          extracurricular tutoring and mentorship to younger students in grades
          6-12.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Students Helping Students
        </h3>
        <p className="text-sm text-[var(--muted)]">
          We believe every student who needs academic support should be able to
          access it without financial pressure. On our platform, students help
          students — and together, they give back to the community. All proceeds
          are donated to SickKids Hospital through our &quot;Coding for
          SickKids&quot; fundraising campaign, turning academic value into
          real-world impact.
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          We seek like-minded sponsoring organizations and individuals to support
          youth development and community change.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border-2 border-yellow-500 bg-yellow-50 p-4 dark:bg-yellow-950/20">
            <p className="text-sm font-bold text-yellow-700 dark:text-yellow-400">
              🥇 Gold Sponsor
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              The website homepage promotional icon, displayed in the first row,
              is valid for one year.
            </p>
          </div>

          <div className="rounded-xl border-2 border-gray-400 bg-gray-50 p-4 dark:bg-gray-800/20">
            <p className="text-sm font-bold text-gray-600 dark:text-gray-300">
              🥈 Silver Sponsor
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              The promotional icon is on the website homepage, in the second row,
              and is valid for 6 months.
            </p>
          </div>

          <div className="rounded-xl border-2 border-amber-700 bg-amber-50 p-4 dark:bg-amber-950/20">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              🥉 Bronze Sponsor
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              The website homepage promotion icon is located in the third row and
              is valid for 3 months.
            </p>
          </div>
        </div>

        <p className="text-xs text-[var(--muted)]">
          Clicking the icon will redirect you to the sponsor&apos;s promotional
          page (we can assist in creating a personal webpage if the sponsor does
          not have one).
        </p>

        <p className="text-sm text-[var(--muted)]">
          Interested in sponsoring?{" "}
          <a
            href="mailto:ethans.coding.class@gmail.com"
            className="font-semibold text-[var(--foreground)] underline transition-colors hover:text-[var(--muted)]"
          >
            ethans.coding.class@gmail.com
          </a>
        </p>
      </div>
    </section>
  );
}
