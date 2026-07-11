"use client";

import { useEffect, useState } from "react";

export default function SiteSettingsMenu() {
  const [email, setEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/contact-email")
      .then((res) => res.json())
      .then((data) => {
        if (data.contact_email) setEmail(data.contact_email);
      })
      .catch((err) => console.error(err));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/settings/contact-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_email: email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update contact email");

      setMessage({ type: "success", text: "Contact email updated successfully!" });
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Configuration
        </p>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Site Settings
        </h2>
      </header>

      <form onSubmit={handleSave} className="space-y-4 max-w-md">
        <div className="space-y-2">
          <label htmlFor="contact_email" className="text-sm font-medium text-[var(--foreground)]">
            Public Contact Email
          </label>
          <input
            id="contact_email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="block w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] transition-colors"
            placeholder="e.g. hello@yanlearn.com"
          />
          <p className="text-xs text-[var(--muted)]">
            This email is shown publicly on the Help and Sponsors pages.
          </p>
        </div>

        {message && (
          <div
            className={`rounded-lg p-3 text-sm font-medium ${
              message.type === "success"
                ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--foreground)] px-4 py-2.5 text-sm font-bold text-[var(--background)] transition-all hover:bg-[var(--foreground)]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </section>
  );
}
