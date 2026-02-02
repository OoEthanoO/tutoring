import AuthStatusActions, { AuthStatusCard } from "@/components/AuthStatusActions";
import AdminUserManager from "@/components/AdminUserManager";
import CourseCreator from "@/components/CourseCreator";

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <h1 className="text-xl font-semibold">Ethan&apos;s Coding Class</h1>
        <AuthStatusActions />
        <AuthStatusCard />
        <AdminUserManager />
        <CourseCreator />
      </div>
    </div>
  );
}
