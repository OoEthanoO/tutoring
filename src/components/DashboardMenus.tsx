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
import EventsMenu from "@/components/EventsMenu";
import EventReminderBanner from "@/components/EventReminderBanner";
import { useRouter, useSearchParams } from "next/navigation";

type MenuKey =
  | "home"
  | "all_courses"
  | "enrolled_courses"
  | "create"
  | "manage_courses"
  | "manage_enrollments"
  | "founder_tools"
  | "help"
  | "events"
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
  const [hasUpcomingEvents, setHasUpcomingEvents] = useState(false);
  const [hasPendingRSVP, setHasPendingRSVP] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedEventId = searchParams.get("event_id");

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

  useEffect(() => {
    if (!isAuthResolved) return;

    const handleDeepLink = async () => {
      if (!deepLinkedEventId) return;

      if (!role) {
        router.push(`/login?redirect=${encodeURIComponent(window.location.href)}`);
        return;
      }

      if (role === "student") {
        alert("Events are only accessible to executives and tutors.");
        setActive("home");
        router.replace("/");
        return;
      }

      // If they are authorized, we need to make sure events are loaded and active
      try {
        const response = await fetch("/api/events");
        if (response.ok) {
          const data = await response.json();
          const events = data.events || [];
          const event = events.find((e: any) => e.id === deepLinkedEventId);

          if (!event) {
            alert("Event not found or you don't have permission to view it.");
            router.replace("/");
            return;
          }

          setActive("events");
          
          // Wait for the EventsMenu to render
          setTimeout(() => {
            const el = document.getElementById(`event-${deepLinkedEventId}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth" });
              // Highlight it briefly
              el.classList.add("ring-2", "ring-[var(--foreground)]");
              setTimeout(() => el.classList.remove("ring-2", "ring-[var(--foreground)]"), 2000);
            }
          }, 500);
        }
      } catch (err) {
        console.error("Deep link handling failed", err);
      }
    };

    handleDeepLink();
  }, [deepLinkedEventId, isAuthResolved, role, router]);

  useEffect(() => {
    if (!role || (role !== "founder" && role !== "executive")) {
      setHasUpcomingEvents(false);
      return;
    }

    const checkEvents = async () => {
      try {
        const response = await fetch("/api/events");
        if (response.ok) {
          const data = await response.json();
          const events = data.events || [];
          setHasUpcomingEvents(events.length > 0);

          // Detect pending RSVPs for executives
          if (role === "executive") {
             const user = await getCurrentUser();
             if (user) {
               const now = new Date();
               const pending = events.some((event: any) => {
                 const isPastDeadline = event.deadline && now > new Date(event.deadline);
                 if (isPastDeadline) return false;
                 return event.event_dates.some((date: any) => 
                   !date.event_responses.some((r: any) => r.user_id === user.id)
                 );
               });
               setHasPendingRSVP(pending);
             }
          } else {
            setHasPendingRSVP(false);
          }
        }
      } catch (err) {
        console.error("Failed to check events", err);
      }
    };

    checkEvents();
  }, [role]);

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

    if (role === "founder" || role === "executive") {
      items.push({ key: "events", label: "Events" });
    }

    items.push({ key: "help", label: "Help" });

    items.push({ key: "sponsors", label: "For Sponsors" });

    return items;
  }, [role, hasUpcomingEvents]);

  const activeMenu: MenuKey = menus.some((item) => item.key === active)
    ? active
    : "home";

  if (!isAuthResolved) {
    return null;
  }

  return (
    <div className="space-y-6">
      {hasPendingRSVP && activeMenu !== "events" && (
        <div className="animate-in fade-in slide-in-from-top duration-500">
          <EventReminderBanner onAction={() => setActive("events")} />
        </div>
      )}
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
      {activeMenu === "events" ? <EventsMenu /> : null}
      {activeMenu === "sponsors" ? <SponsorsMenu /> : null}
    </div>
  );
}
