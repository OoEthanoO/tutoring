"use client";

import { useEffect, useState } from "react";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getAuthContext, onAuthChange } from "@/lib/authClient";

type BannedEmail = {
  email: string;
  created_at: string;
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function AdminBannedEmails() {
  const [isFounderAccess, setIsFounderAccess] = useState(false);
  const [bannedEmails, setBannedEmails] = useState<BannedEmail[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [status, setStatus] = useState<StatusState>({ type: "idle", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const auth = await getAuthContext();
      const user = auth.user;
      const role = resolveUserRole(user?.email ?? null, user?.role ?? null);
      setIsFounderAccess(isFounder(role as any));
    };
    load();
    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (!isFounderAccess) return;

    const fetchBannedEmails = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/admin/banned-emails");
        if (response.ok) {
          const data = await response.json();
          setBannedEmails(data.bannedEmails || []);
        } else {
          setStatus({ type: "error", message: "Failed to load banned emails." });
        }
      } catch {
        setStatus({ type: "error", message: "Network error loading banned emails." });
      } finally {
        setIsLoading(false);
      }
    };

    fetchBannedEmails();
  }, [isFounderAccess]);

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    const email = emailInput.trim().toLowerCase();
    
    if (!window.confirm(`Are you sure you want to ban ${email}? This will immediately permanently delete any existing account with this email.`)) {
      return;
    }

    setIsSubmitting(true);
    setStatus({ type: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/banned-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setStatus({ type: "success", message: `Banned ${email}.` });
        setEmailInput("");
        // Reload list
        const reloadResponse = await fetch("/api/admin/banned-emails");
        if (reloadResponse.ok) {
          const data = await reloadResponse.json();
          setBannedEmails(data.bannedEmails || []);
        }
      } else {
        const payload = await response.json().catch(() => null);
        setStatus({ type: "error", message: payload?.error || "Failed to ban email." });
      }
    } catch {
      setStatus({ type: "error", message: "Network error banning email." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveEmail = async (email: string) => {
    if (!window.confirm(`Are you sure you want to remove ${email} from the ban list?`)) {
      return;
    }

    setStatus({ type: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/banned-emails", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setStatus({ type: "success", message: `Removed ${email} from ban list.` });
        setBannedEmails((prev) => prev.filter((item) => item.email !== email));
      } else {
        const payload = await response.json().catch(() => null);
        setStatus({ type: "error", message: payload?.error || "Failed to remove email." });
      }
    } catch {
      setStatus({ type: "error", message: "Network error removing email." });
    }
  };

  if (!isFounderAccess) return null;

  return (
    <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold">Banned Emails</h2>
          <p className="text-sm text-[var(--muted)]">
            Users with these emails cannot create accounts, and existing accounts are deleted when added.
          </p>
        </div>
      </div>

      <form onSubmit={handleAddEmail} className="mb-6 flex max-w-md gap-3">
        <input
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="Email to ban"
          className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-4 py-2 text-sm focus:border-[var(--foreground)] focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={isSubmitting || !emailInput.trim()}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "Banning..." : "Ban Email"}
        </button>
      </form>

      {status.message && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            status.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
          }`}
        >
          {status.message}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--muted)] border-t-[var(--foreground)]"></div>
        </div>
      ) : bannedEmails.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center">
          <p className="text-sm text-[var(--muted)]">No emails are currently banned.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--border)]/50 text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Banned On</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {bannedEmails.map((item) => (
                <tr key={item.email} className="transition-colors hover:bg-[var(--border)]/30">
                  <td className="px-4 py-3 font-medium">{item.email}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {new Date(item.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemoveEmail(item.email)}
                      className="text-red-500 hover:text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
