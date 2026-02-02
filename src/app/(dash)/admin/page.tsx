"use client";

import { useMemo, useState } from "react";

const focusAreas = [
  "Approve or decline enrollment requests",
  "Assign tutors to courses",
  "View platform-wide metrics",
  "Manage role-based access rules",
];

type UserRow = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  fullName: string;
};

export default function AdminPage() {
  const [searchEmail, setSearchEmail] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const hasResults = useMemo(() => users.length > 0, [users.length]);

  const loadUsers = async () => {
    setIsLoading(true);
    setError("");
    setStatus("");

    try {
      const query = searchEmail.trim();
      const response = await fetch(
        `/api/admin/users?email=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Failed to load users.");
      }

      const payload = await response.json();
      setUsers(payload.users ?? []);
      setStatus(
        payload.users?.length
          ? `Loaded ${payload.users.length} user(s).`
          : "No users matched that email."
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-10">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Founder / Admin
        </p>
        <h1 className="text-3xl font-semibold text-[var(--foreground)]">
          Control center
        </h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Oversee enrollment approvals, tutors, and platform activity from one
          view.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {focusAreas.map((item) => (
          <div
            key={item}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]"
          >
            {item}
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              User directory
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
              Search by email
            </h2>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row">
            <input
              type="search"
              placeholder="Search email"
              value={searchEmail}
              onChange={(event) => setSearchEmail(event.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)] md:w-72"
            />
            <button
              type="button"
              onClick={loadUsers}
              disabled={isLoading}
              className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? "Loading..." : "Search"}
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        {status ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            {status}
          </div>
        ) : null}
        <div className="mt-6 grid gap-3">
          {hasResults ? (
            users.map((user) => (
              <div
                key={user.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]"
              >
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {user.fullName || "Unnamed user"}
                </p>
                <p className="text-xs text-[var(--muted)]">{user.email}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                  <span>Joined: {user.createdAt?.slice(0, 10)}</span>
                  <span>
                    Last sign-in: {user.lastSignInAt?.slice(0, 10) ?? "N/A"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
              Search for users to view results.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
