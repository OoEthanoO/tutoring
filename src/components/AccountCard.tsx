"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveRole } from "@/lib/roles";

type AccountInfo = {
  email: string;
  fullName: string;
  role: string;
};

export default function AccountCard() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    const loadAccount = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.email) {
        setAccount(null);
        return;
      }

      const fullName =
        String(data.user.user_metadata?.full_name ?? "").trim() || "Unnamed user";
      const role = resolveRole(data.user.email);

      setAccount({
        email: data.user.email,
        fullName,
        role,
      });
    };

    loadAccount();
  }, []);

  if (!account) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-xs text-[var(--muted)] shadow-sm">
        Not signed in
      </div>
    );
  }

  const onSignOut = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    setAccount(null);
    setIsSigningOut(false);
  };

  return (
    <div className="w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted)] shadow-[0_10px_24px_-22px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--background)] text-xs font-semibold text-[var(--foreground)]">
              {account.fullName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {account.fullName}
              </p>
              <p className="text-xs text-[var(--muted)]">{account.email}</p>
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--background)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--foreground)]" />
            {account.role}
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSigningOut ? "Signing out" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
