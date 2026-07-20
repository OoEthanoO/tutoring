"use client";

import { useEffect, useState } from "react";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getAuthContext, onAuthChange } from "@/lib/authClient";

type ApprovedAccount = {
  discord_user_id: string;
  label: string | null;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
};

type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};

export default function AdminApprovedDiscordAccounts() {
  const [isFounderAccess, setIsFounderAccess] = useState(false);
  const [approvedAccounts, setApprovedAccounts] = useState<ApprovedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [discordIdInput, setDiscordIdInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [ownerEmailInput, setOwnerEmailInput] = useState("");
  const [status, setStatus] = useState<StatusState>({ type: "idle", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const auth = await getAuthContext();
      const user = auth.user;
      const role = resolveUserRole(user?.email ?? null, user?.role ?? null);
      setIsFounderAccess(isFounder(role));
    };
    load();
    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (!isFounderAccess) return;

    const fetchApprovedAccounts = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/admin/approved-discord-accounts");
        if (response.ok) {
          const data = await response.json();
          setApprovedAccounts(data.approvedAccounts || []);
        } else {
          setStatus({ type: "error", message: "Failed to load approved Discord accounts." });
        }
      } catch {
        setStatus({ type: "error", message: "Network error loading approved Discord accounts." });
      } finally {
        setIsLoading(false);
      }
    };

    fetchApprovedAccounts();
  }, [isFounderAccess]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const discordUserId = discordIdInput.trim();
    if (!discordUserId) return;

    setIsSubmitting(true);
    setStatus({ type: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/approved-discord-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordUserId,
          label: labelInput.trim(),
          ownerEmail: ownerEmailInput.trim(),
        }),
      });

      if (response.ok) {
        setStatus({ type: "success", message: `Approved Discord account ${discordUserId}.` });
        setDiscordIdInput("");
        setLabelInput("");
        setOwnerEmailInput("");
        // Reload list
        const reloadResponse = await fetch("/api/admin/approved-discord-accounts");
        if (reloadResponse.ok) {
          const data = await reloadResponse.json();
          setApprovedAccounts(data.approvedAccounts || []);
        }
      } else {
        const payload = await response.json().catch(() => null);
        setStatus({ type: "error", message: payload?.error || "Failed to approve Discord account." });
      }
    } catch {
      setStatus({ type: "error", message: "Network error approving Discord account." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAccount = async (discordUserId: string) => {
    if (!window.confirm(`Remove approval for Discord account ${discordUserId}? It will be kicked from the server on the next Discord sync.`)) {
      return;
    }

    setStatus({ type: "idle", message: "" });

    try {
      const response = await fetch("/api/admin/approved-discord-accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordUserId }),
      });

      if (response.ok) {
        setStatus({ type: "success", message: `Removed approval for ${discordUserId}.` });
        setApprovedAccounts((prev) =>
          prev.filter((item) => item.discord_user_id !== discordUserId)
        );
      } else {
        const payload = await response.json().catch(() => null);
        setStatus({ type: "error", message: payload?.error || "Failed to remove approved account." });
      }
    } catch {
      setStatus({ type: "error", message: "Network error removing approved account." });
    }
  };

  if (!isFounderAccess) return null;

  return (
    <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold">Approved Discord Accounts</h2>
          <p className="text-sm text-[var(--muted)]">
            These Discord accounts can stay in the server without a linked website account
            (any other unlinked account is kicked by the Discord sync). Set an owner to give
            the account the owner&apos;s course roles and access to their live lesson channels
            — for tutors who need a second account in lesson calls.
          </p>
        </div>
      </div>

      <form onSubmit={handleAddAccount} className="mb-6 flex max-w-3xl flex-col gap-3 md:flex-row">
        <input
          type="text"
          value={discordIdInput}
          onChange={(e) => setDiscordIdInput(e.target.value)}
          placeholder="Discord user ID (e.g. 208796438430941184)"
          pattern="\d{17,20}"
          title="17-20 digit Discord user ID"
          className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-4 py-2 text-sm focus:border-[var(--foreground)] focus:outline-none"
          required
        />
        <input
          type="email"
          value={ownerEmailInput}
          onChange={(e) => setOwnerEmailInput(e.target.value)}
          placeholder="Owner email (optional)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-4 py-2 text-sm focus:border-[var(--foreground)] focus:outline-none"
        />
        <input
          type="text"
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-4 py-2 text-sm focus:border-[var(--foreground)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSubmitting || !discordIdInput.trim()}
          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--background)] transition hover:opacity-80 disabled:opacity-50"
        >
          {isSubmitting ? "Approving..." : "Approve Account"}
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
      ) : approvedAccounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center">
          <p className="text-sm text-[var(--muted)]">No Discord accounts are currently approved.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--border)]/50 text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Discord User ID</th>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Approved On</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {approvedAccounts.map((item) => (
                <tr key={item.discord_user_id} className="transition-colors hover:bg-[var(--border)]/30">
                  <td className="px-4 py-3 font-mono font-medium">{item.discord_user_id}</td>
                  <td className="px-4 py-3">{item.label || <span className="text-[var(--muted)]">—</span>}</td>
                  <td className="px-4 py-3">
                    {item.owner_name || item.owner_email ? (
                      <span>
                        {item.owner_name || item.owner_email}
                        {item.owner_name && item.owner_email ? (
                          <span className="text-[var(--muted)]"> ({item.owner_email})</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {new Date(item.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemoveAccount(item.discord_user_id)}
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
