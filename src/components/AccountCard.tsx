"use client";

import { useEffect, useState } from "react";
import { getAuthContext, onAuthChange } from "@/lib/authClient";
import { resolveUserRole } from "@/lib/roles";

type AccountInfo = {
  email: string;
  fullName: string;
  role: string;
  isImpersonating: boolean;
};

export default function AccountCard() {
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    const loadAccount = async () => {
      const auth = await getAuthContext();
      const user = auth.user;
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
        isImpersonating: auth.isImpersonating,
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
      {account.isImpersonating ? (
        <p className="mt-2 text-xs text-amber-600">Impersonation mode</p>
      ) : null}
    </div>
  );
}
