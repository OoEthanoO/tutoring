import Link from "next/link";

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold">Website under maintenance</h1>
        <p className="max-w-xl text-sm text-[var(--muted)]">
          The website is currently under maintenance. Please try again later.
        </p>
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Founder access is still available.
          </p>
          <Link
            href="/login"
            className="inline-flex rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
          >
            Founder sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
