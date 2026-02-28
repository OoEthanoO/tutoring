"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  discordUserId?: string | null;
  discordUsername?: string | null;
  discordConnectedAt?: string | null;
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

type FeedbackEntry = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  message: string;
  status: string | null;
  createdAt: string;
};

export default function AdminUserManager() {
  const router = useRouter();
  const [isFounder, setIsFounder] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "tutor">(
    "all"
  );
  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);
  const [isSendingDiscordReminder, setIsSendingDiscordReminder] =
    useState(false);
  const [discordReminderSkipList, setDiscordReminderSkipList] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [impersonatedUserId, setImpersonatedUserId] = useState<string | null>(
    null
  );
  const [donationLinks, setDonationLinks] = useState<Record<string, string>>({});
  const [promotedDates, setPromotedDates] = useState<Record<string, string>>(
    {}
  );
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [pendingFeedbackId, setPendingFeedbackId] = useState<string | null>(
    null
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

  const formatFeedbackDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Unknown time";
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

  useEffect(() => {
    if (!isFounder) {
      return;
    }

    const loadMaintenance = async () => {
      const response = await fetch("/api/admin/maintenance");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { enabled?: boolean };
      setMaintenanceEnabled(data.enabled === true);
    };

    loadMaintenance();
  }, [isFounder]);

  useEffect(() => {
    if (!isFounder) {
      return;
    }

    const fetchFeedback = async () => {
      setIsLoadingFeedback(true);
      setFeedbackError("");
      const response = await fetch("/api/admin/feedback");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setFeedbackError(payload?.error ?? "Unable to load feedback.");
        setIsLoadingFeedback(false);
        return;
      }

      const data = (await response.json()) as { feedback?: FeedbackEntry[] };
      setFeedback(data.feedback ?? []);
      setIsLoadingFeedback(false);
    };

    fetchFeedback();
  }, [isFounder]);

  const nonFounderUsers = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return users
      .filter((user) => user.role !== "founder")
      .filter((user) => {
        if (roleFilter === "all") {
          return true;
        }
        return user.role === roleFilter;
      })
      .filter((user) => {
        if (!normalizedSearch) {
          return true;
        }
        const fullName = (user.fullName ?? "").toLowerCase();
        const email = (user.email ?? "").toLowerCase();
        return (
          fullName.includes(normalizedSearch) ||
          email.includes(normalizedSearch)
        );
      });
  }, [users, searchQuery, roleFilter]);

  const deleteFeedback = async (feedbackId: string) => {
    const confirmed = window.confirm("Delete this feedback entry?");
    if (!confirmed) {
      return;
    }

    setPendingFeedbackId(feedbackId);
    setFeedbackError("");

    const response = await fetch("/api/admin/feedback", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackId }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setFeedbackError(payload?.error ?? "Unable to delete feedback.");
      setPendingFeedbackId(null);
      return;
    }

    setFeedback((current) => current.filter((entry) => entry.id !== feedbackId));
    setPendingFeedbackId(null);
  };

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

  const toggleMaintenanceMode = async () => {
    setIsSavingMaintenance(true);
    setStatus({ type: "idle", message: "" });

    const nextValue = !maintenanceEnabled;
    const response = await fetch("/api/admin/maintenance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextValue }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not update maintenance mode.",
      });
      setIsSavingMaintenance(false);
      return;
    }

    setMaintenanceEnabled(nextValue);
    setStatus({
      type: "success",
      message: nextValue
        ? "Maintenance mode enabled."
        : "Maintenance mode disabled.",
    });
    setIsSavingMaintenance(false);
    router.refresh();
  };

  const notifyDiscordUnlinkedUsers = async () => {
    const skipEmails = Array.from(
      new Set(
        discordReminderSkipList
          .split(/[\s,;]+/)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const confirmed = window.confirm(
      skipEmails.length > 0
        ? `Send an email to every account without a connected Discord account? ${skipEmails.length} email(s) in the skip list will be excluded.`
        : "Send an email to every account without a connected Discord account?"
    );
    if (!confirmed) {
      return;
    }

    setIsSendingDiscordReminder(true);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "notify_discord_unlinked",
        skipEmails,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not send Discord reminder emails.",
      });
      setIsSendingDiscordReminder(false);
      return;
    }

    const data = (await response.json()) as {
      targetCount: number;
      sentCount: number;
      failedCount: number;
      skippedCount: number;
    };
    const skipSummary =
      data.skippedCount > 0 ? ` (${data.skippedCount} skipped)` : "";

    setStatus({
      type: data.failedCount > 0 ? "error" : "success",
      message:
        data.failedCount > 0
          ? `Sent ${data.sentCount} of ${data.targetCount} Discord reminder emails (${data.failedCount} failed)${skipSummary}.`
          : `Sent ${data.sentCount} Discord reminder emails${skipSummary}.`,
    });
    setIsSendingDiscordReminder(false);
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

      <div className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-[var(--muted)]">
            Maintenance mode:{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {maintenanceEnabled ? "ON" : "OFF"}
            </span>
          </p>
          <button
            type="button"
            onClick={toggleMaintenanceMode}
            disabled={isSavingMaintenance}
            className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSavingMaintenance
              ? "Saving..."
              : maintenanceEnabled
                ? "Turn off maintenance"
                : "Turn on maintenance"}
          </button>
          <button
            type="button"
            onClick={notifyDiscordUnlinkedUsers}
            disabled={isSendingDiscordReminder}
            className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSendingDiscordReminder
              ? "Sending emails..."
              : "Notify users to connect Discord"}
          </button>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="discord-reminder-skip-list"
            className="text-xs text-[var(--muted)]"
          >
            Skip emails for Discord reminder (comma, space, semicolon, or new line separated)
          </label>
          <textarea
            id="discord-reminder-skip-list"
            value={discordReminderSkipList}
            onChange={(event) => setDiscordReminderSkipList(event.target.value)}
            rows={2}
            placeholder="example1@email.com, example2@email.com"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by name or email"
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)] sm:max-w-sm"
        />
        <select
          value={roleFilter}
          onChange={(event) =>
            setRoleFilter(
              event.target.value as "all" | "student" | "tutor"
            )
          }
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)] sm:w-44"
        >
          <option value="all">All roles</option>
          <option value="student">Students</option>
          <option value="tutor">Tutors</option>
        </select>
      </div>

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
                <p className="text-xs text-[var(--muted)]">
                  Discord:{" "}
                  {user.discordUserId
                    ? user.discordUsername
                      ? `Connected (${user.discordUsername})`
                      : "Connected"
                    : "Not connected"}
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

      <div className="space-y-3 rounded-xl border border-[var(--border)] px-4 py-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Feedback inbox
          </p>
          <p className="text-sm text-[var(--muted)]">
            Recent submissions from logged-in users.
          </p>
        </div>
        {isLoadingFeedback ? (
          <p className="text-sm text-[var(--muted)]">Loading feedback...</p>
        ) : null}
        {feedbackError ? (
          <p className="text-sm text-red-500">{feedbackError}</p>
        ) : null}
        {!isLoadingFeedback && !feedbackError && feedback.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No feedback yet.</p>
        ) : null}
        {!isLoadingFeedback && !feedbackError && feedback.length > 0 ? (
          <div className="space-y-2">
            {feedback.map((entry) => (
              <div
                key={entry.id}
                className="relative space-y-2 rounded-xl border border-[var(--border)] px-3 py-3 pr-28"
              >
                <button
                  type="button"
                  disabled={pendingFeedbackId === entry.id}
                  onClick={() => deleteFeedback(entry.id)}
                  className="absolute top-3 rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                  style={{ right: "0.75rem" }}
                >
                  {pendingFeedbackId === entry.id ? "Deleting..." : "Delete"}
                </button>
                <p className="text-xs text-[var(--muted)]">
                  {formatFeedbackDate(entry.createdAt)}
                </p>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {entry.userName?.trim() || "Unnamed user"}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Account: {entry.userEmail || "Unknown"}
                </p>
                <p className="text-sm text-[var(--foreground)]">{entry.message}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
