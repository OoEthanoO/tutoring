"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole, type UserRole } from "@/lib/roles";
import AdminUserManager from "@/components/AdminUserManager";
import CourseCreator from "@/components/CourseCreator";
import CoursesMenu from "@/components/CoursesMenu";
import EnrolledCoursesMenu from "@/components/EnrolledCoursesMenu";
import HomeMenu from "@/components/HomeMenu";
import ManageEnrollmentsMenu from "@/components/ManageEnrollmentsMenu";
import ManageMyCoursesMenu from "@/components/ManageMyCoursesMenu";

type MenuKey =
  | "home"
  | "all_courses"
  | "enrolled_courses"
  | "create"
  | "manage_courses"
  | "manage_enrollments"
  | "founder_tools";

type MenuItem = {
  key: MenuKey;
  label: string;
};

export default function DashboardMenus() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [active, setActive] = useState<MenuKey>("home");

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setRole(null);
        setActive("home");
        setIsAuthResolved(true);
        return;
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null
      );
      setRole(resolvedRole);
      setIsAuthResolved(true);
      if (resolvedRole === "student") {
        setActive("home");
      }
    };

    load();

    return onAuthChange(load);
  }, []);

  const menus = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { key: "home", label: "Home" },
      { key: "all_courses", label: "All courses" },
    ];

    if (role) {
      items.push({ key: "enrolled_courses", label: "Enrolled courses" });
    }

    if (role && canManageCourses(role)) {
      items.push({ key: "create", label: "Create" });
      items.push({ key: "manage_courses", label: "Manage my courses" });
    }

    if (role === "founder") {
      items.push({ key: "manage_enrollments", label: "Manage enrollments" });
      items.push({ key: "founder_tools", label: "Manage accounts" });
    }

    return items;
  }, [role]);

  if (!isAuthResolved) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-6 bg-[var(--background)]/90 px-6 py-3 backdrop-blur">
        <nav className="flex flex-wrap gap-2">
        {menus.map((menu) => (
          <button
            key={menu.key}
            type="button"
            onClick={() => {
              setActive(menu.key);
              if (menu.key === "home") {
                document.getElementById("home")?.scrollIntoView({
                  behavior: "smooth",
                });
              }
            }}
            className={
              active === menu.key
                ? "rounded-full border border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] transition"
                : "rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
            }
          >
            {menu.label}
          </button>
        ))}
        </nav>
      </div>

      {active === "home" ? <HomeMenu /> : null}
      {active === "all_courses" ? <CoursesMenu /> : null}
      {active === "enrolled_courses" ? <EnrolledCoursesMenu /> : null}
      {active === "create" ? <CourseCreator /> : null}
      {active === "manage_courses" ? <ManageMyCoursesMenu /> : null}
      {active === "manage_enrollments" ? <ManageEnrollmentsMenu /> : null}
      {active === "founder_tools" ? <AdminUserManager /> : null}
    </div>
  );
}
