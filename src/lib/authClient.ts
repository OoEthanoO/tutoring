export type ClientUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  email_verified_at: string | null;
};

const authEvent = "auth-change";
const viewAsStorageKey = "founder-view-as-user";

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

export const getServerCurrentUser = async (): Promise<ClientUser | null> => {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { user?: ClientUser };
  return data.user ?? null;
};

const getStoredViewAsUser = (): ClientUser | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(viewAsStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ClientUser;
    if (!parsed?.id || !parsed?.email) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const setFounderViewAsUser = (user: ClientUser | null) => {
  if (typeof window === "undefined") {
    return;
  }
  if (!user) {
    window.localStorage.removeItem(viewAsStorageKey);
    return;
  }
  window.localStorage.setItem(viewAsStorageKey, JSON.stringify(user));
};

export const clearFounderViewAsUser = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(viewAsStorageKey);
};

export const getCurrentUser = async (): Promise<ClientUser | null> => {
  const actualUser = await getServerCurrentUser();
  if (!actualUser) {
    clearFounderViewAsUser();
    return null;
  }

  // Only founder sessions can use client-side "view as user".
  if (actualUser.role !== "founder") {
    clearFounderViewAsUser();
    return actualUser;
  }

  const viewAsUser = getStoredViewAsUser();
  if (!viewAsUser || viewAsUser.id === actualUser.id) {
    return actualUser;
  }

  return viewAsUser;
};
