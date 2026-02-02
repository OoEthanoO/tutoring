import AuthStatusActions, { AuthStatusCard } from "@/components/AuthStatusActions";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-5xl items-start justify-center px-6 py-8">
        <div className="flex flex-col items-center gap-4">
          <AuthStatusCard />
          <AuthStatusActions />
        </div>
      </div>
    </div>
  );
}
