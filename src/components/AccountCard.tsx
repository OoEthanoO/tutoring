"use client";

import { useEffect, useState } from "react";
import { getAuthContext, onAuthChange } from "@/lib/authClient";
import { resolveUserRole } from "@/lib/roles";

type AccountInfo = {
  email: string;
  fullName: string;
  role: string;
  isImpersonating: boolean;
  discordUserId: string | null;
  discordUsername: string | null;
};

export default function AccountCard({ onClick }: { onClick?: () => void }) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [isHovered, setIsHovered] = useState(false);

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

      const discordUserId = user.discord_user_id ?? null;
      const discordUsername = user.discord_username ?? null;

      setAccount({
        email: user.email,
        fullName,
        role,
        isImpersonating: auth.isImpersonating,
        discordUserId,
        discordUsername,
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
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm transition-all h-14 min-w-[200px] ${onClick ? "cursor-pointer hover:shadow-md hover:border-[var(--foreground)]" : ""
        }`}
    >
      <div className="flex flex-col flex-1 pr-4 border-r border-[var(--border)] h-full justify-center min-w-0">
        <p className="text-sm font-semibold leading-tight text-[var(--foreground)] truncate">{account.fullName}</p>
        <div className="grid mt-0.5 text-[10px] leading-tight font-medium">
          <span style={{ gridArea: '1 / 1', opacity: isHovered ? 0 : 1, transition: 'opacity 0.2s' }} className="truncate text-[var(--muted)]">
            {account.email}
          </span>
          <span style={{ gridArea: '1 / 1', opacity: isHovered ? 1 : 0, transition: 'opacity 0.2s', color: '#5865F2' }} className="truncate">
            {account.discordUserId
              ? account.discordUsername || "Discord connected"
              : "Discord not connected"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 items-center px-1 text-[10px] font-medium uppercase text-[var(--muted)] border-0">
          {account.role}
        </span>
        {account.isImpersonating ? (
          <span className="inline-flex h-6 items-center rounded-md bg-amber-500/10 px-2 text-[10px] font-medium uppercase text-amber-600">
            Impersonating
          </span>
        ) : null}
      </div>
    </div>
  );
}
