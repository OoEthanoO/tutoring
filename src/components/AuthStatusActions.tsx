"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getCurrentUser,
  getServerCurrentUser,
  onAuthChange,
  broadcastAuthChange,
  setFounderViewAsUser,
  clearFounderViewAsUser,
  type ClientUser,
} from "@/lib/authClient";
import AccountCard from "@/components/AccountCard";

export default function AuthStatusActions() {
  const [actualUser, setActualUser] = useState<ClientUser | null>(null);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [isViewAsOpen, setIsViewAsOpen] = useState(false);
  const [viewAsOptions, setViewAsOptions] = useState<ClientUser[]>([]);
  const [viewAsId, setViewAsId] = useState("");
  const [isSavingViewAs, setIsSavingViewAs] = useState(false);
  const [viewAsStatus, setViewAsStatus] = useState<{
    type: "idle" | "error";
    message: string;
  }>({ type: "idle", message: "" });
  const [fullNameDraft, setFullNameDraft] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<{
    type: "idle" | "error" | "success";
    message: string;
  }>({ type: "idle", message: "" });
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      const serverUser = await getServerCurrentUser();
      setActualUser(serverUser);
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }

      if (!menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isMenuOpen]);

  if (isSignedIn === null) {
    return null;
  }

  if (isSignedIn) {
    const onSignOut = async () => {
      setIsSigningOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      clearFounderViewAsUser();
      broadcastAuthChange();
      setIsSigningOut(false);
      setIsMenuOpen(false);
    };

    const openNameEditor = async () => {
      setNameStatus({ type: "idle", message: "" });
      const user = await getCurrentUser();
      const fullName = String(user?.full_name ?? "").trim();
      setFullNameDraft(fullName);
      setIsMenuOpen(false);
      setIsEditNameOpen(true);
    };

    const openViewAsEditor = async () => {
      const serverUser = await getServerCurrentUser();
      setActualUser(serverUser);
      if (!serverUser || serverUser.role !== "founder") {
        return;
      }

      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        setViewAsStatus({
          type: "error",
          message: "Unable to load accounts.",
        });
        return;
      }

      const payload = (await response.json()) as {
        users?: Array<{
          id: string;
          email: string | null;
          fullName?: string;
          role?: string;
        }>;
      };

      const options = (payload.users ?? [])
        .filter((entry) => entry.id && entry.email)
        .map((entry) => ({
          id: entry.id,
          email: String(entry.email),
          full_name: entry.fullName ?? null,
          role: entry.role ?? "student",
          email_verified_at: null,
        }));

      setViewAsOptions(options);

      const currentViewUser = await getCurrentUser();
      if (
        currentViewUser &&
        currentViewUser.id !== serverUser.id &&
        options.some((entry) => entry.id === currentViewUser.id)
      ) {
        setViewAsId(currentViewUser.id);
      } else {
        setViewAsId("");
      }

      setViewAsStatus({ type: "idle", message: "" });
      setIsMenuOpen(false);
      setIsViewAsOpen(true);
    };

    const closeNameEditor = () => {
      setNameStatus({ type: "idle", message: "" });
      setIsEditNameOpen(false);
    };

    const closeViewAsEditor = () => {
      setViewAsStatus({ type: "idle", message: "" });
      setIsViewAsOpen(false);
    };

    const saveName = async () => {
      const nextName = fullNameDraft.trim();
      if (!nextName) {
        setNameStatus({ type: "error", message: "Name cannot be empty." });
        return;
      }

      setIsSavingName(true);
      setNameStatus({ type: "idle", message: "" });

      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: nextName }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setNameStatus({
          type: "error",
          message: payload?.error ?? "Unable to update name.",
        });
        setIsSavingName(false);
        return;
      }

      setIsSavingName(false);
      setNameStatus({ type: "success", message: "Name updated." });
      broadcastAuthChange();
      setTimeout(() => {
        setIsEditNameOpen(false);
      }, 500);
    };

    const saveViewAs = async () => {
      if (!actualUser || actualUser.role !== "founder") {
        return;
      }
      setIsSavingViewAs(true);
      setViewAsStatus({ type: "idle", message: "" });

      if (!viewAsId) {
        clearFounderViewAsUser();
        broadcastAuthChange();
        setIsSavingViewAs(false);
        setIsViewAsOpen(false);
        window.location.reload();
        return;
      }

      const selectedUser = viewAsOptions.find((entry) => entry.id === viewAsId);
      if (!selectedUser) {
        setViewAsStatus({
          type: "error",
          message: "Please select a valid account.",
        });
        setIsSavingViewAs(false);
        return;
      }

      setFounderViewAsUser(selectedUser);
      broadcastAuthChange();
      setIsSavingViewAs(false);
      setIsViewAsOpen(false);
      window.location.reload();
    };

    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="rounded border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--foreground)]"
        >
          Account
        </button>
        {isMenuOpen ? (
          <div className="absolute right-0 z-30 mt-2 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
            <button
              type="button"
              onClick={openNameEditor}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--border)]"
            >
              Edit name
            </button>
            {actualUser?.role === "founder" ? (
              <button
                type="button"
                onClick={openViewAsEditor}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--border)]"
              >
                View as user
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSignOut}
              disabled={isSigningOut}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        ) : null}
        {isEditNameOpen ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Account
                </p>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">
                  Update your name
                </h3>
              </div>
              <input
                type="text"
                value={fullNameDraft}
                onChange={(event) => setFullNameDraft(event.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              />
              {nameStatus.type !== "idle" ? (
                <p
                  className={
                    nameStatus.type === "error"
                      ? "text-xs text-red-500"
                      : "text-xs text-emerald-500"
                  }
                >
                  {nameStatus.message}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeNameEditor}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveName}
                  disabled={isSavingName}
                  className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSavingName ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isViewAsOpen ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Founder tools
                </p>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">
                  View as account
                </h3>
              </div>
              <select
                value={viewAsId}
                onChange={(event) => setViewAsId(event.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              >
                <option value="">No override (your founder view)</option>
                {viewAsOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {(entry.full_name || entry.email).trim()} ({entry.email})
                  </option>
                ))}
              </select>
              {viewAsStatus.type === "error" ? (
                <p className="text-xs text-red-500">{viewAsStatus.message}</p>
              ) : null}
              <p className="text-xs text-[var(--muted)]">
                This only changes client-side rendering for troubleshooting.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeViewAsEditor}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveViewAs}
                  disabled={isSavingViewAs}
                  className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSavingViewAs ? "Saving..." : "Apply"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="rounded border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--foreground)]"
    >
      Sign in
    </Link>
  );
}

export function AuthStatusLink() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  if (isSignedIn === null || isSignedIn) {
    return null;
  }

  return (
    <Link href="/login" className="transition hover:text-[#1b140f]">
      Login
    </Link>
  );
}

export function AuthStatusCard() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setIsSignedIn(Boolean(user));
    };

    load();

    return onAuthChange(load);
  }, []);

  if (!isSignedIn) {
    return null;
  }

  return <AccountCard />;
}
