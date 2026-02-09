"use client";

import { useEffect, useMemo, useState } from "react";
import {
  broadcastAuthChange,
  getAuthContext,
  onAuthChange,
} from "@/lib/authClient";
import { resolveUserRole } from "@/lib/roles";

type AdminUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: "founder" | "tutor" | "student";
  donationLink?: string;
  tutorPromotedAt?: string | null;
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function AdminUserManager() {
  const [isFounder, setIsFounder] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [impersonatedUserId, setImpersonatedUserId] = useState<string | null>(
    null
  );
  const [donationLinks, setDonationLinks] = useState<Record<string, string>>({});
  const [promotedDates, setPromotedDates] = useState<Record<string, string>>(
    {}
  );

  const toLocalDateTimeInput = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    const pad = (num: number) => String(num).padStart(2, "0");
    return [
      `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
      `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
    ].join("T");
  };

  const formatPromotedDate = (value?: string | null) => {
    if (!value) {
      return "Unknown";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Unknown";
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  };

  useEffect(() => {
    const load = async () => {
      const auth = await getAuthContext();
      const user = auth.user;
      const role = resolveUserRole(user?.email ?? null, user?.role ?? null);
      setIsFounder(role === "founder");
      setImpersonatedUserId(auth.impersonatedUserId);
      if (role !== "founder") {
        setUsers([]);
      }
    };

    load();

    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (!isFounder) {
      return;
    }

    const fetchUsers = async () => {
      setIsLoading(true);
      setStatus({ type: "idle", message: "" });

      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message:
            payload?.error ??
            "Unable to load users. Please try again.",
        });
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as { users: AdminUser[] };
      setUsers(data.users);
      setDonationLinks(
        Object.fromEntries(
          (data.users ?? []).map((user) => [
            user.id,
            user.donationLink ?? "",
          ])
        )
      );
      setPromotedDates(
        Object.fromEntries(
          (data.users ?? []).map((user) => [
            user.id,
            user.tutorPromotedAt
              ? toLocalDateTimeInput(user.tutorPromotedAt)
              : "",
          ])
        )
      );
      setIsLoading(false);
    };

    fetchUsers();
  }, [isFounder]);

  const nonFounderUsers = useMemo(
    () => users.filter((user) => user.role !== "founder"),
    [users]
  );

  const updateRole = async (userId: string, role: "tutor" | "student") => {
    const target = users.find((user) => user.id === userId);
    const name = target?.fullName || target?.email || "this user";
    const action =
      role === "tutor"
        ? `Promote ${name} to tutor?`
        : `Demote ${name} to student?`;
    if (!window.confirm(action)) {
      return;
    }

    setPendingId(userId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message:
          payload?.error ??
          "Could not update role. Please try again.",
      });
      setPendingId(null);
      return;
    }

    const data = (await response.json()) as { user: AdminUser };

    setUsers((current) =>
      current.map((user) => (user.id === data.user.id ? data.user : user))
    );
    setPromotedDates((current) => ({
      ...current,
      [data.user.id]: data.user.tutorPromotedAt
        ? toLocalDateTimeInput(data.user.tutorPromotedAt)
        : current[data.user.id] ?? "",
    }));
    setStatus({
      type: "success",
      message: `Updated ${data.user.fullName || data.user.email || "user"}.`,
    });
    setPendingId(null);
  };

  const startImpersonation = async (user: AdminUser) => {
    const name = user.fullName || user.email || "this user";
    const confirmed = window.confirm(`Impersonate ${name}?`);
    if (!confirmed) {
      return;
    }

    setPendingId(user.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/auth/impersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not start impersonation.",
      });
      setPendingId(null);
      return;
    }

    setStatus({
      type: "success",
      message: `Now impersonating ${name}.`,
    });
    setPendingId(null);
    broadcastAuthChange();
  };

  const updatePromotedDate = async (userId: string) => {
    setPendingId(userId);
    setStatus({ type: "idle", message: "" });

    const dateValue = promotedDates[userId] ?? "";
    const isoDate = dateValue ? new Date(dateValue).toISOString() : null;

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        tutorPromotedAt: isoDate,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message:
          payload?.error ??
          "Could not update promotion date. Please try again.",
      });
      setPendingId(null);
      return;
    }

    const data = (await response.json()) as { user: AdminUser };
    setUsers((current) =>
      current.map((user) => (user.id === data.user.id ? data.user : user))
    );
    setPromotedDates((current) => ({
      ...current,
      [data.user.id]: data.user.tutorPromotedAt
        ? toLocalDateTimeInput(data.user.tutorPromotedAt)
        : "",
    }));
    setStatus({
      type: "success",
      message: `Updated promotion date for ${data.user.fullName || data.user.email || "user"}.`,
    });
    setPendingId(null);
  };

  const updateDonationLink = async (userId: string) => {
    setPendingId(userId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        donationLink: donationLinks[userId] ?? "",
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not update donation link.",
      });
      setPendingId(null);
      return;
    }

    const data = (await response.json()) as { user: AdminUser };
    setUsers((current) =>
      current.map((user) => (user.id === data.user.id ? data.user : user))
    );
    setStatus({
      type: "success",
      message: `Updated donation link for ${data.user.fullName || data.user.email || "user"}.`,
    });
    setPendingId(null);
  };

  const deleteAccount = async (user: AdminUser) => {
    const name = user.fullName || user.email || "this user";
    const firstConfirm = window.confirm(
      `Delete account for ${name}? This cannot be undone.`
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(
      `Please confirm again to permanently delete ${name}.`
    );
    if (!secondConfirm) {
      return;
    }

    const typedEmail = window.prompt(
      `Type the full email for ${name} to confirm deletion.`
    );
    if (!typedEmail || typedEmail.trim() !== (user.email ?? "").trim()) {
      setStatus({
        type: "error",
        message: "Deletion cancelled. Email did not match.",
      });
      return;
    }

    setPendingId(user.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not delete account.",
      });
      setPendingId(null);
      return;
    }

    setUsers((current) => current.filter((entry) => entry.id !== user.id));
    setStatus({
      type: "success",
      message: `Deleted account for ${name}.`,
    });
    setPendingId(null);
  };

  if (!isFounder) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Manage accounts
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Manage student and tutor accounts
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

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading users...</p>
      ) : null}

      {!isLoading && nonFounderUsers.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No users found.</p>
      ) : null}

      <div className="space-y-3">
        {nonFounderUsers.map((user) => {
          const isPending = pendingId === user.id;
          return (
            <div
              key={user.id}
              className="flex flex-col gap-3 rounded-xl border border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {user.fullName || "Unnamed user"}
                </p>
                <p className="text-xs text-[var(--muted)]">{user.email}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Role: {user.role}
                </p>
                {user.role === "tutor" ? (
                  <p className="text-xs text-[var(--muted)]">
                    Promoted: {formatPromotedDate(user.tutorPromotedAt)}
                  </p>
                ) : null}
                {impersonatedUserId === user.id ? (
                  <p className="text-xs font-semibold text-amber-600">
                    Currently impersonating this user
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startImpersonation(user)}
                  className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isPending ? "Working..." : "Impersonate"}
                </button>
                {user.role !== "tutor" ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => updateRole(user.id, "tutor")}
                    className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isPending ? "Updating..." : "Make tutor"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => updateRole(user.id, "student")}
                      className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isPending ? "Updating..." : "Make student"}
                    </button>
                    <div className="space-y-2 rounded-xl border border-[var(--border)]/70 bg-[var(--surface)] px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        Tutor settings
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-[var(--muted)]">
                          Donation link
                        </label>
                        <input
                          type="url"
                          value={donationLinks[user.id] ?? ""}
                          onChange={(event) =>
                            setDonationLinks((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          placeholder="Donation link"
                          className="min-w-[12rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                        />
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => updateDonationLink(user.id)}
                          className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isPending ? "Saving..." : "Save link"}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-[var(--muted)]">
                          Promotion time
                        </label>
                        <input
                          type="datetime-local"
                          value={promotedDates[user.id] ?? ""}
                          onChange={(event) =>
                            setPromotedDates((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          className="w-56 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                        />
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => updatePromotedDate(user.id)}
                          className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isPending ? "Saving..." : "Save time"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => deleteAccount(user)}
                  className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isPending ? "Working..." : "Delete account"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
