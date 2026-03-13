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
  role: "founder" | "executive" | "student";
  donationLink?: string;
  tutorPromotedAt?: string | null;
  discordUserId?: string | null;
  discordUsername?: string | null;
  discordConnectedAt?: string | null;
  isJunior: boolean;
  grade?: string;
  school?: string;
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

type StudentApplication = {
  id: string;
  course_id: string;
  course?: { title: string };
  guardian_email: string;
  student_full_name: string;
  school_name: string;
  grade: string;
  parent_guardian_name: string;
  parent_guardian_phone: string;
  consent_name: string;
  created_at: string;
};

export default function AdminUserManager() {
  const router = useRouter();
  const [isFounder, setIsFounder] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "executive">(
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
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [schools, setSchools] = useState<Record<string, string>>({});
  const [allSchools, setAllSchools] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [pendingFeedbackId, setPendingFeedbackId] = useState<string | null>(
    null
  );
  const [selectedApplications, setSelectedApplications] = useState<StudentApplication[]>([]);
  const [isLoadingApplication, setIsLoadingApplication] = useState(false);
  const [applicationError, setApplicationError] = useState("");

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
      setGrades(
        Object.fromEntries(
          (data.users ?? []).map((user) => [user.id, user.grade ?? ""])
        )
      );
      setSchools(
        Object.fromEntries(
          (data.users ?? []).map((user) => [user.id, user.school ?? ""])
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

    const fetchSchools = async () => {
      const response = await fetch("/api/admin/users?schools=true");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { schools?: string[] };
      setAllSchools(data.schools ?? []);
    };

    fetchSchools();
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

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return users
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

  const updateRole = async (userId: string, role: "executive" | "student") => {
    const target = users.find((user) => user.id === userId);
    const name = target?.fullName || target?.email || "this user";
    const action =
      role === "executive"
        ? `Promote ${name} to executive?`
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

  const toggleJuniorStatus = async (userId: string, isJunior: boolean) => {
    setPendingId(userId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, isJunior }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not update junior status.",
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
      message: `Updated junior status for ${data.user.fullName || data.user.email || "user"}.`,
    });
    setPendingId(null);
  };

  const updateGradeSchool = async (userId: string) => {
    setPendingId(userId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        grade: grades[userId] ?? "",
        school: schools[userId] ?? "",
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Could not update grade/school.",
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
      message: `Updated grade/school for ${data.user.fullName || data.user.email || "user"}.`,
    });
    setPendingId(null);

    // Refresh school suggestions
    const schoolsResponse = await fetch("/api/admin/users?schools=true");
    if (schoolsResponse.ok) {
      const schoolsData = (await schoolsResponse.json()) as { schools?: string[] };
      setAllSchools(schoolsData.schools ?? []);
    }
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

  const viewApplication = async (studentId: string) => {
    setIsLoadingApplication(true);
    setApplicationError("");
    setSelectedApplications([]);

    const response = await fetch(`/api/admin/student-applications/${studentId}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setApplicationError(payload?.error ?? "Unable to load applications.");
      setIsLoadingApplication(false);
      return;
    }

    const data = (await response.json()) as { applications: StudentApplication[] };
    if (!data.applications || data.applications.length === 0) {
      setApplicationError("No applications found for this user.");
    } else {
      setSelectedApplications(data.applications);
    }
    setIsLoadingApplication(false);
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
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Manage accounts
          </p>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            Manage student and executive accounts
          </h2>
        </div>
        <a
          href="/api/admin/student-applications/export"
          download="student_applications.xlsx"
          className="flex items-center gap-2 rounded-full border border-green-600 bg-green-50 px-4 py-2 text-xs font-bold text-green-700 transition hover:bg-green-600 hover:text-white active:scale-95 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-600 dark:hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export to Excel (.xlsx)
        </a>
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
              event.target.value as "all" | "student" | "executive"
            )
          }
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)] sm:w-44"
        >
          <option value="all">All roles</option>
          <option value="student">Students</option>
          <option value="executive">Executives</option>
        </select>
      </div>

      {status.type !== "idle" ? (
        <div
          className={
            status.type === "error"
              ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
              : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
          }
        >
          {status.message}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading users...</p>
      ) : null}

      {!isLoading && filteredUsers.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No users found.</p>
      ) : null}

      <div className="space-y-3">
        {filteredUsers.map((user) => {
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
                {user.role === "executive" ? (
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
                {user.role !== "founder" ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startImpersonation(user)}
                    className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isPending ? "Working..." : "Impersonate"}
                  </button>
                ) : null}
                {user.role !== "executive" && user.role !== "founder" ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => updateRole(user.id, "executive")}
                    className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isPending ? "Updating..." : "Make executive"}
                  </button>
                ) : (
                  <>
                    {user.role !== "founder" ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => updateRole(user.id, "student")}
                        className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isPending ? "Updating..." : "Make student"}
                      </button>
                    ) : null}
                    <div className="space-y-2 rounded-xl border border-[var(--border)]/70 bg-[var(--surface)] px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        {user.role === "founder" ? "Founder settings" : "Executive settings"}
                      </p>
                      {user.role !== "founder" ? (
                        <div className="flex items-center gap-2">
                          <input
                            id={`junior-toggle-${user.id}`}
                            type="checkbox"
                            checked={!!user.isJunior}
                            disabled={isPending}
                            onChange={(event) => toggleJuniorStatus(user.id, event.target.checked)}
                            className="h-4 w-4 rounded border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition focus:ring-0"
                          />
                          <label
                            htmlFor={`junior-toggle-${user.id}`}
                            className="text-xs font-medium text-[var(--foreground)]"
                          >
                            Junior Executive (Hidden from &quot;Our Team&quot; list)
                          </label>
                        </div>
                      ) : null}
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
                      {user.role !== "founder" ? (
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
                      ) : null}
                    </div>
                  </>
                )}
                {user.role !== "founder" ? (
                  <>
                    <div className="space-y-2 rounded-xl border border-[var(--border)]/70 bg-[var(--surface)] px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        Student info
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-[var(--muted)]">Grade</label>
                        <input
                          type="text"
                          value={grades[user.id] ?? ""}
                          onChange={(event) =>
                            setGrades((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          placeholder="e.g. 10"
                          className="w-24 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-[var(--muted)]">School</label>
                        <input
                          type="text"
                          list={`school-options-${user.id}`}
                          value={schools[user.id] ?? ""}
                          onChange={(event) =>
                            setSchools((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          placeholder="School name"
                          className="min-w-[12rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                        />
                        <datalist id={`school-options-${user.id}`}>
                          {allSchools.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => updateGradeSchool(user.id)}
                          className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isPending ? "Saving..." : "Save info"}
                        </button>
                      </div>
                    </div>
                    {user.role === "student" ? (
                      <button
                        type="button"
                        disabled={isLoadingApplication && pendingId === user.id}
                        onClick={() => {
                          setPendingId(user.id);
                          viewApplication(user.id).finally(() => setPendingId(null));
                        }}
                        className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isLoadingApplication && pendingId === user.id ? "Loading..." : "View Applications"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => deleteAccount(user)}
                      className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isPending ? "Working..." : "Delete account"}
                    </button>
                  </>
                ) : null}
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

      {/* Student Application Modal */}
      {(selectedApplications.length > 0 || applicationError) && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/50 overflow-y-auto overscroll-contain">
          <div className="w-full max-w-2xl flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl overflow-hidden overscroll-contain">
            <div className="p-6 space-y-4 overflow-y-auto overscroll-contain max-h-[90vh]">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Registration details
                  </p>
                  <h3 className="text-lg font-semibold text-[var(--foreground)]">
                    Student Application History
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setSelectedApplications([]);
                    setApplicationError("");
                  }}
                  className="group flex items-center justify-center w-8 h-8 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-all hover:border-[var(--foreground)] hover:text-[var(--foreground)] active:scale-95"
                  aria-label="Close modal"
                >
                  <svg className="w-4 h-4 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {applicationError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                  {applicationError}
                </div>
              ) : (
                <div className="space-y-6">
                  {selectedApplications.map((app, index) => (
                    <div key={app.id} className="space-y-3 rounded-xl border border-[var(--border)] p-4 bg-[var(--surface-muted)]">
                      <div className="flex flex-wrap justify-between items-start gap-2 border-b border-[var(--border)] pb-2 mb-2">
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                             Application #{selectedApplications.length - index}
                          </p>
                          <p className="text-sm font-semibold text-[var(--foreground)]">
                            Course: {app.course?.title || "Unknown Course"}
                          </p>
                        </div>
                        <p className="text-[10px] text-[var(--muted)]">
                          Submitted: {formatFeedbackDate(app.created_at)}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Guardian Email</p>
                          <p className="text-sm text-[var(--foreground)] break-all">{app.guardian_email}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Student Name</p>
                          <p className="text-sm text-[var(--foreground)]">{app.student_full_name}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">School & Grade</p>
                          <p className="text-sm text-[var(--foreground)]">{app.school_name} (Grade {app.grade})</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Parent Contact</p>
                          <p className="text-sm text-[var(--foreground)]">{app.parent_guardian_name} ({app.parent_guardian_phone})</p>
                        </div>
                      </div>
                      <div className="space-y-1 pt-2 border-t border-[var(--border)]/50">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Consent Signature</p>
                        <p className="text-xs italic text-[var(--foreground)] underline decoration-amber-500/30 underline-offset-4">{app.consent_name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button
                  onClick={() => {
                    setSelectedApplications([]);
                    setApplicationError("");
                  }}
                  className="rounded-full border border-[var(--foreground)] bg-[var(--surface)] px-8 py-2.5 text-xs font-bold text-[var(--foreground)] transition-all hover:bg-[var(--foreground)] hover:text-[var(--surface)] active:scale-[0.98]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section >
  );
}
