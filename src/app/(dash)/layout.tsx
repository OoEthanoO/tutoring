import Link from "next/link";
import RequireFullName from "@/components/RequireFullName";
import AccountCard from "@/components/AccountCard";

const navItems = [
  { label: "Admin", href: "/admin" },
  { label: "Tutor", href: "/tutor" },
  { label: "Student", href: "/student" },
];

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              TutorHub
            </p>
            <p className="text-lg font-semibold text-[var(--foreground)]">
              Dashboards
            </p>
          </div>
          <div className="hidden items-center gap-4 md:flex">
            <AccountCard />
          </div>
          <nav className="flex items-center gap-4 text-sm text-[var(--muted)]">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full border border-transparent px-4 py-2 transition hover:text-[var(--foreground)]"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/"
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
            >
              Home
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <RequireFullName>{children}</RequireFullName>
      </main>
    </div>
  );
}
