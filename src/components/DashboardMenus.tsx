"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, resolveUserRole, type UserRole } from "@/lib/roles";
import AdminUserManager from "@/components/AdminUserManager";
import CourseCreator from "@/components/CourseCreator";
import CoursesMenu from "@/components/CoursesMenu";
import EnrolledCoursesMenu from "@/components/EnrolledCoursesMenu";
import HomeMenu from "@/components/HomeMenu";
import ManageEnrollmentsMenu from "@/components/ManageEnrollmentsMenu";
import ManageMyCoursesMenu from "@/components/ManageMyCoursesMenu";
import HelpMenu from "@/components/HelpMenu";
import SponsorsMenu from "@/components/SponsorsMenu";

type MenuKey =
  | "home"
  | "all_courses"
  | "enrolled_courses"
  | "create"
  | "manage_courses"
  | "manage_enrollments"
  | "founder_tools"
  | "help"
  | "sponsors";

type MenuItem = {
  key: MenuKey;
  label: string;
};

export default function DashboardMenus() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [active, setActive] = useState<MenuKey>("home");
  const navRef = useRef<HTMLElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollIndicators = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    // Wait for the DOM paint so scrollWidth is correct
    const rafId = requestAnimationFrame(() => updateScrollIndicators());
    el.addEventListener("scroll", updateScrollIndicators, { passive: true });
    window.addEventListener("resize", updateScrollIndicators);
    return () => {
      cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", updateScrollIndicators);
      window.removeEventListener("resize", updateScrollIndicators);
    };
  }, [updateScrollIndicators, role, isAuthResolved]);

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

    items.push({ key: "help", label: "Help" });
    items.push({ key: "sponsors", label: "For Sponsors" });

    return items;
  }, [role]);

  const activeMenu: MenuKey = menus.some((item) => item.key === active)
    ? active
    : "home";

  if (!isAuthResolved) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-6 border-b border-[var(--border)] bg-[var(--background)]/90 px-6 backdrop-blur">
          <nav
            ref={navRef}
            className="scrollbar-hide flex overflow-x-auto"
            style={{
              maskImage:
                canScrollLeft && canScrollRight
                  ? "linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)"
                  : canScrollLeft
                    ? "linear-gradient(to right, transparent, black 4rem)"
                    : canScrollRight
                      ? "linear-gradient(to right, black calc(100% - 4rem), transparent)"
                      : undefined,
              WebkitMaskImage:
                canScrollLeft && canScrollRight
                  ? "linear-gradient(to right, transparent, black 4rem, black calc(100% - 4rem), transparent)"
                  : canScrollLeft
                    ? "linear-gradient(to right, transparent, black 4rem)"
                    : canScrollRight
                      ? "linear-gradient(to right, black calc(100% - 4rem), transparent)"
                      : undefined,
            }}
          >
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
                  activeMenu === menu.key
                    ? "whitespace-nowrap border-b-2 border-[var(--foreground)] px-4 py-3 text-xs font-bold text-[var(--foreground)] transition-colors"
                    : "whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                }
              >
                {menu.label}
              </button>
            ))}
          </nav>
      </div>

      {activeMenu === "home" ? <HomeMenu isSignedIn={Boolean(role)} /> : null}
      {activeMenu === "all_courses" ? <CoursesMenu /> : null}
      {activeMenu === "enrolled_courses" ? <EnrolledCoursesMenu /> : null}
      {activeMenu === "create" ? <CourseCreator /> : null}
      {activeMenu === "manage_courses" ? <ManageMyCoursesMenu /> : null}
      {activeMenu === "manage_enrollments" ? <ManageEnrollmentsMenu /> : null}
      {activeMenu === "founder_tools" ? <AdminUserManager /> : null}
      {activeMenu === "help" ? <HelpMenu /> : null}
      {activeMenu === "sponsors" ? <SponsorsMenu /> : null}
    </div>
  );
}
