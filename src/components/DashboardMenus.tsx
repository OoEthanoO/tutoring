"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { canManageCourses, resolveUserRole, type UserRole } from "@/lib/roles";
import AdminUserManager from "@/components/AdminUserManager";
import CourseCreator from "@/components/CourseCreator";
import CoursesMenu from "@/components/CoursesMenu";

type MenuKey = "courses" | "create" | "founder";

type MenuItem = {
  key: MenuKey;
  label: string;
};

export default function DashboardMenus() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [active, setActive] = useState<MenuKey>("courses");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setRole(null);
        setActive("courses");
        return;
      }

      const resolvedRole = resolveUserRole(
        data.user.email,
        data.user.user_metadata?.role ?? null
      );
      setRole(resolvedRole);
      if (resolvedRole === "student") {
        setActive("courses");
      }
    };

    load();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user ?? null;
        if (!user) {
          setRole(null);
          setActive("courses");
          return;
        }

        const resolvedRole = resolveUserRole(
          user.email ?? null,
          user.user_metadata?.role ?? null
        );
        setRole(resolvedRole);
        if (resolvedRole === "student") {
          setActive("courses");
        }
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  const menus = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [{ key: "courses", label: "Courses" }];

    if (role && canManageCourses(role)) {
      items.push({ key: "create", label: "Create" });
    }

    if (role === "founder") {
      items.push({ key: "founder", label: "Founder tools" });
    }

    return items;
  }, [role]);

  if (!role) {
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
            onClick={() => setActive(menu.key)}
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

      {active === "courses" ? <CoursesMenu /> : null}
      {active === "create" ? <CourseCreator /> : null}
      {active === "founder" ? <AdminUserManager /> : null}
    </div>
  );
}
