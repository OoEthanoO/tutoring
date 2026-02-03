"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveRoleByEmail } from "@/lib/roles";

type AdminUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: "founder" | "tutor" | "student";
  donationLink?: string;
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
  const [donationLinks, setDonationLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      const role = resolveRoleByEmail(data.user?.email ?? null);
      setIsFounder(role === "founder");
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const role = resolveRoleByEmail(session?.user?.email ?? null);
        setIsFounder(role === "founder");
        if (role !== "founder") {
          setUsers([]);
        }
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
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
    setStatus({
      type: "success",
      message: `Updated ${data.user.fullName || data.user.email || "user"}.`,
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

  if (!isFounder) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Promotion
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Promote students to tutors
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
              </div>
              <div className="flex flex-wrap gap-2">
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
                    <div className="flex flex-wrap gap-2">
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
                        className="w-64 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
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
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
