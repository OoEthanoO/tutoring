"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveUserRole } from "@/lib/roles";

type AccountInfo = {
  email: string;
  fullName: string;
  role: string;
};

export default function AccountCard() {
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    const loadAccount = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.email) {
        setAccount(null);
        return;
      }

      const fullName =
        String(data.user.user_metadata?.full_name ?? "").trim() || "Unnamed user";
      const role = resolveUserRole(
        data.user.email,
        data.user.user_metadata?.role ?? null
      );

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
      <div className="text-sm text-[var(--muted)]">Not signed in.</div>
    );
  }

  return (
    <div className="text-sm text-[var(--foreground)]">
      <p className="font-semibold">{account.fullName}</p>
      <p className="text-xs text-[var(--muted)]">{account.email}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">Role: {account.role}</p>
    </div>
  );
}
