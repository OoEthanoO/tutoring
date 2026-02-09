import { cookies } from "next/headers";
import Link from "next/link";
import AuthStatusActions, { AuthStatusCard } from "@/components/AuthStatusActions";
import DashboardMenus from "@/components/DashboardMenus";
import Footer from "@/components/Footer";
import { getSessionUser } from "@/lib/authServer";
import { resolveUserRole } from "@/lib/roles";
import { getMaintenanceMode } from "@/lib/siteSettings";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  const user = await getSessionUser(token);
  const role = resolveUserRole(user?.email ?? null, user?.role ?? null);
  const isFounder = role === "founder";
  const maintenanceEnabled = await getMaintenanceMode();
  const showMaintenance = maintenanceEnabled && !isFounder;

  if (showMaintenance) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
          <h1 className="text-2xl font-semibold">Website under maintenance</h1>
          <p className="max-w-xl text-sm text-[var(--muted)]">
            The website is currently under maintenance. Please try again later.
          </p>
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)]">
              Founder access is still available.
            </p>
            <Link
              href="/login"
              className="inline-flex rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
            >
              Founder sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-10">
        {maintenanceEnabled && isFounder ? (
          <div className="rounded-2xl border-2 border-amber-500 bg-amber-50 px-5 py-4 text-amber-900">
            <p className="text-xs font-semibold uppercase tracking-[0.2em]">
              Maintenance Mode Active
            </p>
            <p className="mt-1 text-sm font-semibold">
              Only founder accounts can access the website right now.
            </p>
            <p className="mt-1 text-xs">
              Turn it off from Manage accounts when maintenance is complete.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Ethan&apos;s Coding Class</h1>
          <div className="flex flex-wrap items-center gap-4">
            <AuthStatusCard />
            <AuthStatusActions />
          </div>
        </div>
        <DashboardMenus />
        <Footer />
      </div>
    </div>
  );
}
