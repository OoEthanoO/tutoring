"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// The Discord OAuth callback redirects to /?discord=<code> when connecting
// fails (success redirects to the server invite instead), so every code here
// is an error explanation.
const messagesByCode: Record<string, string> = {
  state_missing:
    "The Discord connection attempt expired. Please try connecting again.",
  state_invalid:
    "The Discord connection attempt could not be verified. Please try connecting again.",
  token_exchange_failed:
    "Discord did not authorize the connection. Please try again.",
  token_missing:
    "Discord did not authorize the connection. Please try again.",
  identity_fetch_failed:
    "We couldn't read your Discord account details. Please try again.",
  identity_invalid:
    "We couldn't read your Discord account details. Please try again.",
  lookup_failed:
    "Something went wrong while saving your Discord connection. Please try again.",
  link_failed:
    "Something went wrong while saving your Discord connection. Please try again.",
  account_reserved:
    "This Discord account is reserved as a tutor's approved extra account, so it can't be linked to a website login. Use a different Discord account, or ask an admin to remove the approval first.",
};

export default function DiscordConnectBanner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const code = searchParams.get("discord");
  if (!code) {
    return null;
  }

  const message =
    messagesByCode[code] ?? "Discord connection failed. Please try again.";

  const handleDismiss = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("discord");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="bg-red-600 px-4 py-3 text-white sm:flex sm:items-center sm:justify-center sm:px-6 lg:px-8">
      <div className="flex w-full max-w-7xl items-center justify-between gap-4">
        <p className="text-sm font-medium">
          <strong>Discord connection failed:</strong> {message}
        </p>
        <button
          type="button"
          className="-m-1.5 flex flex-none items-center justify-center p-1.5 rounded-full hover:bg-red-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <svg
            className="h-5 w-5 text-white"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
