"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DonationHistoryMenu from "./DonationHistoryMenu";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, isExecutive, isFounder, isHighRankingChiefExecutive, resolveUserRole, type UserRole } from "@/lib/roles";
import TutorApplicationFormModal from "./TutorApplicationFormModal";
import WithdrawHoursMenu from "@/components/WithdrawHoursMenu";
import AdminUserManager from "@/components/AdminUserManager";
import CourseCreator from "@/components/CourseCreator";
import CoursesMenu from "@/components/CoursesMenu";
import EnrolledCoursesMenu from "@/components/EnrolledCoursesMenu";
import AllCoursesTableMenu from "@/components/AllCoursesTableMenu";
import HomeMenu from "@/components/HomeMenu";
import OurTeamMenu from "@/components/OurTeamMenu";
import ManageEnrollmentsMenu from "@/components/ManageEnrollmentsMenu";
import ManageMyCoursesMenu from "@/components/ManageMyCoursesMenu";
import RolesManagerMenu from "@/components/RolesManagerMenu";
import MyClassesMenu from "@/components/MyClassesMenu";
import HelpMenu from "@/components/HelpMenu";
import SponsorsMenu from "@/components/SponsorsMenu";
import EventsMenu from "@/components/EventsMenu";
import FormsMenu from "@/components/FormsMenu";
import EventReminderBanner from "@/components/EventReminderBanner";
import CourseRequestsMenu from "@/components/CourseRequestsMenu";
import SiteSettingsMenu from "@/components/SiteSettingsMenu";
import { useRouter, useSearchParams } from "next/navigation";

type MenuKey =
  | "home"
  | "all_courses"
  | "all_courses_table"
  | "our_team" | "donation_history"
  | "enrolled_courses"
  | "my_classes"

  | "manage_course_requests"
  | "manage_courses"
  | "manage_enrollments"
  | "founder_tools"
  | "withdrawals"
  | "help"
  | "events"
  | "forms"
  | "trash"
  | "roles_manager"
  | "sponsors"
  | "site_settings";

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
  const [hasForms, setHasForms] = useState(false);
  const [hasPendingRSVP, setHasPendingRSVP] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isOnboardingCompleted, setIsOnboardingCompleted] = useState<boolean | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedEventId = searchParams.get("event_id");
  const deepLinkedFormId = searchParams.get("form_id");

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
      setCurrentUser(user);
      if (!user) {
        setRole(null);
        setActive("home");
        setIsAuthResolved(true);
        return;
      }

      const customRoleLevels = Array.isArray(user.custom_roles)
        ? user.custom_roles.map((r: any) => r.role_level).filter(Boolean)
        : [user.custom_roles?.role_level].filter(Boolean);
      if (user.custom_role) {
        customRoleLevels.push(user.custom_role);
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null,
        customRoleLevels
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
    if (!currentUser || !role) {
      setIsOnboardingCompleted(null);
      return;
    }

    const isExempt = role === "founder" || role === "CEO" || role === "COO";

    if (isExecutive(role) && !isExempt) {
      const checkOnboarding = async () => {
        try {
          const res = await fetch("/api/tutor-application/status", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            setIsOnboardingCompleted(data.completed);
          } else {
            setIsOnboardingCompleted(false);
          }
        } catch (err) {
          console.error("Failed to check tutor application status:", err);
          setIsOnboardingCompleted(false);
        }
      };
      checkOnboarding();
    } else {
      setIsOnboardingCompleted(true);
    }
  }, [currentUser, role]);

  useEffect(() => {
    if (!isAuthResolved) return;

    const handleDeepLink = async () => {
      if (!deepLinkedEventId && !deepLinkedFormId) return;

      if (!role) {
        router.push(`/login?redirect=${encodeURIComponent(window.location.href)}`);
        return;
      }

      if (role === "student") {
        alert("Events and forms are only accessible to executives and tutors.");
        setActive("home");
        router.replace("/");
        return;
      }

      if (deepLinkedEventId) {
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
          console.error("Deep link handling failed for event", err);
        }
      }

      if (deepLinkedFormId) {
        try {
          const response = await fetch("/api/forms");
          if (response.ok) {
            const data = await response.json();
            const forms = data.forms || [];
            const form = forms.find((f: any) => f.id === deepLinkedFormId);

            if (!form) {
              alert("Form not found or you don't have permission to view it.");
              router.replace("/");
              return;
            }

            setActive("forms");
            
            // Wait for the FormsMenu to render
            setTimeout(() => {
              const el = document.getElementById(`form-${deepLinkedFormId}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth" });
                // Highlight it briefly
                el.classList.add("ring-2", "ring-[var(--foreground)]");
                setTimeout(() => el.classList.remove("ring-2", "ring-[var(--foreground)]"), 2000);
              }
            }, 500);
          }
        } catch (err) {
          console.error("Deep link handling failed for form", err);
        }
      }
    };

    handleDeepLink();
  }, [deepLinkedEventId, deepLinkedFormId, isAuthResolved, role, router]);

  useEffect(() => {
    if (!role || !isExecutive(role)) {
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

          // Detect pending RSVPs for executives (non-founders)
          if (isExecutive(role) && !isFounder(role)) {
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

    const checkForms = async () => {
      try {
        const response = await fetch("/api/forms");
        if (response.ok) {
          const data = await response.json();
          const forms = data.forms || [];
          setHasForms(forms.length > 0);
        }
      } catch (err) {
        console.error("Failed to check forms", err);
      }
    };

    if (isExecutive(role)) {
      checkEvents();
      checkForms();
    }
  }, [role]);

  useEffect(() => {
    if (!role || !canManageCourses(role) || (isExecutive(role) && !isFounder(role))) {
      setTrashCount(0);
      return;
    }

    const checkTrash = async () => {
      try {
        const response = await fetch("/api/courses?trash=true");
        if (response.ok) {
          const data = await response.json();
          setTrashCount(data.courses?.length ?? 0);
        }
      } catch (err) {
        console.error("Failed to check trash", err);
      }
    };

    checkTrash();

    const handleRefresh = () => checkTrash();
    window.addEventListener("refresh-trash", handleRefresh);
    return () => {
      window.removeEventListener("refresh-trash", handleRefresh);
    };
  }, [role, active]);

  const menus = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { key: "home", label: "Home" },
      { key: "all_courses", label: "All courses" },
      { key: "all_courses_table", label: "Courses table" },
      { key: "our_team", label: "Our team" },
        { key: "donation_history", label: "Donation history" },
    ];

    if (role) {
      items.push({ key: "enrolled_courses", label: "My enrollments" });
      items.push({ key: "my_classes", label: "My classes" });
    }

    if (role && canManageCourses(role)) {
      // Single unified requests page (founders will have approve/reject controls)
      items.push({ key: "manage_course_requests", label: "Course requests" });
      items.push({ key: "manage_courses", label: "My courses" });
    }

    if (isFounder(role)) {
      items.push({ key: "manage_enrollments", label: "Manage enrollments" });
      items.push({ key: "founder_tools", label: "Manage accounts" });
    }

    if (role && isHighRankingChiefExecutive(role)) {
      items.push({ key: "withdrawals", label: "Withdraw hours" });
      items.push({ key: "site_settings", label: "Site Settings" });
    }

    if (isExecutive(role)) {
      items.push({ key: "events", label: "Events" });
    }

    if (isFounder(role) || (isExecutive(role) && (hasForms || active === "forms"))) {
      items.push({ key: "forms", label: "Forms" });
    }

    if (trashCount > 0 && !isExecutive(role)) {
      items.push({ key: "trash", label: "Trash" });
    }
    // Founders/high-level roles should always see trash if there is something in it
    if (trashCount > 0 && isFounder(role)) {
      items.push({ key: "trash", label: "Trash" });
    }

    if (isFounder(role)) {
      items.push({ key: "roles_manager", label: "Roles" });
    }

    items.push({ key: "help", label: "Help" });

    items.push({ key: "sponsors", label: "For Sponsors" });

    return items;
  }, [role, hasUpcomingEvents, hasForms, trashCount, active, currentUser]);

  const activeMenu: MenuKey = menus.some((item) => item.key === active)
    ? active
    : "home";

  useEffect(() => {
    const rafId = requestAnimationFrame(() => updateScrollIndicators());
    return () => cancelAnimationFrame(rafId);
  }, [menus, updateScrollIndicators]);

  if (!isAuthResolved) {
    return null;
  }

  return (
    <div className="space-y-6">
      {isOnboardingCompleted === false && (
        <div className="animate-in fade-in slide-in-from-top duration-500">
          <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3.5 text-amber-900 dark:text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.05)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 dark:bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600 dark:bg-amber-500"></span>
                </span>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                    Mandatory Action Required
                  </p>
                  <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                    Your executive onboarding is incomplete. Please submit the Tutor Consent & Honor Agreement form.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(true)}
                className="self-start rounded-full bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition-all sm:self-auto shadow-md"
              >
                Complete Onboarding
              </button>
            </div>
          </div>
        </div>
      )}
      {hasPendingRSVP && activeMenu !== "events" && (
        <div className="animate-in fade-in slide-in-from-top duration-500">
          <EventReminderBanner onAction={() => setActive("events")} />
        </div>
      )}
      <div className="sticky top-0 z-20 -mx-6 border-b border-[var(--border)] bg-[var(--background)]/90 px-6 backdrop-blur">
        <div className="relative">
          <div
            className="w-full"
            style={{
              maskImage:
                canScrollLeft && canScrollRight
                  ? "linear-gradient(to right, transparent, black 3rem, black calc(100% - 3rem), transparent)"
                  : canScrollLeft
                    ? "linear-gradient(to right, transparent, black 3rem)"
                    : canScrollRight
                      ? "linear-gradient(to right, black calc(100% - 3rem), transparent)"
                      : undefined,
              WebkitMaskImage:
                canScrollLeft && canScrollRight
                  ? "linear-gradient(to right, transparent, black 3rem, black calc(100% - 3rem), transparent)"
                  : canScrollLeft
                    ? "linear-gradient(to right, transparent, black 3rem)"
                    : canScrollRight
                      ? "linear-gradient(to right, black calc(100% - 3rem), transparent)"
                      : undefined,
            }}
          >
            <nav
              ref={navRef}
              className="scrollbar-hide flex overflow-x-auto"
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
          {canScrollLeft && (
            <button
              aria-label="Scroll tabs left"
              onClick={() => navRef.current?.scrollBy({ left: -360, behavior: "smooth" })}
              className="pointer-events-auto absolute left-0 top-0 bottom-0 z-30 flex w-12 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          )}
          {canScrollRight && (
            <button
              aria-label="Scroll tabs right"
              onClick={() => navRef.current?.scrollBy({ left: 360, behavior: "smooth" })}
              className="pointer-events-auto absolute right-0 top-0 bottom-0 z-30 flex w-12 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          )}
        </div>
      </div>

      {activeMenu === "home" ? <HomeMenu isSignedIn={Boolean(role)} onOpenTeamTab={() => setActive("our_team")} /> : null}
      {activeMenu === "all_courses" ? <CoursesMenu /> : null}
      {activeMenu === "all_courses_table" ? <AllCoursesTableMenu /> : null}
      {activeMenu === "our_team" ? <OurTeamMenu /> : null}
      {activeMenu === "donation_history" ? <DonationHistoryMenu /> : null}
      {activeMenu === "enrolled_courses" ? <EnrolledCoursesMenu /> : null}
      {activeMenu === "my_classes" ? <MyClassesMenu /> : null}
      {activeMenu === "manage_course_requests" ? <CourseRequestsMenu /> : null}
      {activeMenu === "manage_courses" ? <ManageMyCoursesMenu /> : null}
      {activeMenu === "manage_enrollments" ? <ManageEnrollmentsMenu /> : null}
      {activeMenu === "founder_tools" ? <AdminUserManager /> : null}
      {activeMenu === "withdrawals" ? <WithdrawHoursMenu /> : null}
      {activeMenu === "help" ? <HelpMenu /> : null}
      {activeMenu === "events" ? <EventsMenu /> : null}
      {activeMenu === "forms" ? <FormsMenu /> : null}
      {activeMenu === "trash" ? <ManageMyCoursesMenu isTrashMode={true} /> : null}
      {activeMenu === "roles_manager" ? <RolesManagerMenu /> : null}
      {activeMenu === "sponsors" ? <SponsorsMenu /> : null}
      {activeMenu === "site_settings" ? <SiteSettingsMenu /> : null}

      <TutorApplicationFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmitSuccess={() => {
          setIsOnboardingCompleted(true);
        }}
        initialEmail={currentUser?.email || ""}
        initialFullName={currentUser?.full_name || ""}
      />
    </div>
  );
}
