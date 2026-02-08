"use client";

import { useEffect, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
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
      const user = await getCurrentUser();
      if (!user?.email) {
        setAccount(null);
        return;
      }

      const fullName =
        String(user.full_name ?? "").trim() || "Unnamed user";
      const role = resolveUserRole(user.email, user.role ?? null);

      setAccount({
        email: user.email,
        fullName,
        role,
      });
    };

    loadAccount();

    return onAuthChange(loadAccount);
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
