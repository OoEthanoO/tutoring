import Link from "next/link";
import AccountCard from "@/components/AccountCard";
import AuthStatusActions, { AuthStatusLink } from "@/components/AuthStatusActions";

const roles = [
  {
    title: "Founder / Admin",
    summary: "Full visibility across tutors, courses, and enrollment decisions.",
    href: "/admin",
  },
  {
    title: "Tutor",
    summary: "Create courses, manage posts, and track enrolled students.",
    href: "/tutor",
  },
  {
    title: "Student",
    summary: "Apply to enroll, get approval updates, and join classes.",
    href: "/student",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-[var(--border)] text-xs font-semibold text-[var(--foreground)]">
            TH
          </span>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              TutorHub
            </p>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Nonprofit ops
            </p>
          </div>
        </div>
        <nav className="hidden items-center gap-6 text-sm text-[var(--muted)] md:flex">
          <Link href="#roles" className="transition hover:text-[var(--foreground)]">
            Roles
          </Link>
          <Link href="#flow" className="transition hover:text-[var(--foreground)]">
            Enrollment
          </Link>
          <AuthStatusLink />
        </nav>
        <div className="hidden md:block">
          <AccountCard />
        </div>
        <AuthStatusActions />
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-20 pt-6">
        <section className="space-y-6 border-b border-[var(--border)] pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Built for tutoring nonprofits
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-[var(--foreground)] md:text-5xl">
            Run your program with calm, clear workflows.
          </h1>
          <p className="max-w-2xl text-base text-[var(--muted)]">
            Founders oversee everything, tutors run their courses, and students
            get verified enrollment updates.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-full border border-[var(--foreground)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--foreground)] hover:text-white"
            >
              Start
            </Link>
            <Link
              href="#roles"
              className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
            >
              View roles
            </Link>
          </div>
        </section>

        <section id="roles" className="mt-10 grid gap-4 md:grid-cols-3">
          {roles.map((role) => (
            <Link
              key={role.title}
              href={role.href}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--foreground)]"
            >
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {role.title}
              </h3>
              <p className="mt-2 text-sm text-[var(--muted)]">{role.summary}</p>
            </Link>
          ))}
        </section>

        <section
          id="flow"
          className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
        >
          <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Enrollment flow
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Email validation + approval tracking
              </h2>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Students receive confirmation when they enroll and when their
                request is accepted or declined.
              </p>
            </div>
            <div className="grid gap-2 text-sm text-[var(--muted)]">
              {[
                "Student submits enrollment form with verified email.",
                "System sends confirmation email.",
                "Tutor or founder reviews the request.",
                "Decision triggers accepted/declined email.",
              ].map((step) => (
                <div
                  key={step}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                >
                  {step}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
