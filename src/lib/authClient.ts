export type ClientUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  email_verified_at: string | null;
};

const authEvent = "auth-change";

export const broadcastAuthChange = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(authEvent));
  }
};

export const onAuthChange = (callback: () => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(authEvent, callback);
  return () => window.removeEventListener(authEvent, callback);
};

export const getCurrentUser = async (): Promise<ClientUser | null> => {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { user?: ClientUser };
  return data.user ?? null;
};
