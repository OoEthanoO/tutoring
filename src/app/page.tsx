import AuthStatusActions, { AuthStatusCard } from "@/components/AuthStatusActions";
import DashboardMenus from "@/components/DashboardMenus";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Ethan&apos;s Coding Class</h1>
          <div className="flex flex-wrap items-center gap-4">
            <AuthStatusCard />
            <AuthStatusActions />
          </div>
        </div>
        <DashboardMenus />
      </div>
    </div>
  );
}
