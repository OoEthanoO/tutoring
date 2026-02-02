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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted)]">
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {account.fullName}
          </p>
          <p>{account.email}</p>
          <p className="mt-2 inline-flex rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--foreground)]">
            {account.role}
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSigningOut ? "Signing out" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
