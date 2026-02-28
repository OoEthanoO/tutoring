export type ClientUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  email_verified_at: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  discord_connected_at: string | null;
};

export type AuthContext = {
  user: ClientUser | null;
  actor: ClientUser | null;
  isImpersonating: boolean;
  impersonatedUserId: string | null;
};

const authEvent = "auth-change";

export const broadcastAuthChange = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(authEvent));
  }
};

export const onAuthChange = (callback: () => void) => {
  if (typeof window === "undefined") {
    return () => { };
  }

  window.addEventListener(authEvent, callback);
  return () => window.removeEventListener(authEvent, callback);
};

export const getCurrentUser = async (): Promise<ClientUser | null> => {
  const auth = await getAuthContext();
  return auth.user;
};

export const getAuthContext = async (): Promise<AuthContext> => {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    return {
      user: null,
      actor: null,
      isImpersonating: false,
      impersonatedUserId: null,
    };
  }

  const data = (await response.json()) as {
    user?: ClientUser | null;
    actor?: ClientUser | null;
    isImpersonating?: boolean;
    impersonatedUserId?: string | null;
  };
  return {
    user: data.user ?? null,
    actor: data.actor ?? null,
    isImpersonating: data.isImpersonating === true,
    impersonatedUserId: data.impersonatedUserId ?? null,
  };
};
