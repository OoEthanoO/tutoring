"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DonationHistoryMenu from "./DonationHistoryMenu";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, isExecutive, isFounder, isHighRankingChiefExecutive, resolveUserRole, type UserRole } from "@/lib/roles";
import TutorApplicationFormModal from "./TutorApplicationFormModal";
import WithdrawHoursMenu from "@/components/WithdrawHoursMenu";
import AdminUserManager from "@/components/AdminUserManager";
import EmailHistoryMenu from "@/components/EmailHistoryMenu";
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
import NavDropdown from "@/components/NavDropdown";
import AnalyticsMenu from "@/components/AnalyticsMenu";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type MenuKey =
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
  | "emails"
  | "withdrawals"
  | "help"
  | "events"
  | "forms"
  | "trash"
  | "roles_manager"
  | "sponsors"
  | "site_settings"
  | "analytics";

export type MenuItem = {
  key: MenuKey;
  label: string;
};

const ALL_MENU_KEYS: readonly MenuKey[] = [
  "home",
  "all_courses",
  "all_courses_table",
  "our_team",
  "donation_history",
  "enrolled_courses",
  "my_classes",
  "manage_course_requests",
  "manage_courses",
  "manage_enrollments",
  "founder_tools",
  "emails",
  "withdrawals",
  "help",
  "events",
  "forms",
  "trash",
  "roles_manager",
  "sponsors",
  "site_settings",
  "analytics",
];

const isMenuKey = (value: string | null): value is MenuKey =>
  Boolean(value) && (ALL_MENU_KEYS as readonly string[]).includes(value as string);

// Nav entries are either a direct tab or a labeled dropdown group of tabs.
type NavEntry =
  | { type: "item"; item: MenuItem }
  | { type: "group"; key: string; label: string; items: MenuItem[] };

export default function DashboardMenus() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [hasForms, setHasForms] = useState(false);
  const [hasPendingRSVP, setHasPendingRSVP] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isOnboardingCompleted, setIsOnboardingCompleted] = useState<boolean | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const deepLinkedEventId = searchParams.get("event_id");
  const deepLinkedFormId = searchParams.get("form_id");

  // The URL is the source of truth for the active menu, so refreshing, sharing
  // links, and browser back/forward all work. Authorization is enforced further
  // down by the activeMenu fallback against the role-filtered menus list.
  const menuParam = searchParams.get("menu");
  const active: MenuKey = isMenuKey(menuParam) ? menuParam : "home";

  const navigateToMenu = useCallback(
    (key: MenuKey, opts?: { replace?: boolean; keepDeepLinkParams?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key === "home") {
        params.delete("menu");
      } else {
        params.set("menu", key);
      }
      if (!opts?.keepDeepLinkParams) {
        params.delete("event_id");
        params.delete("form_id");
      }
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts?.replace) {
        router.replace(url, { scroll: false });
      } else {
        router.push(url, { scroll: false });
      }
    },
    [searchParams, pathname, router]
  );

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      setCurrentUser(user);
      if (!user) {
        setRole(null);
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

            navigateToMenu("events", { replace: true, keepDeepLinkParams: true });

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

            navigateToMenu("forms", { replace: true, keepDeepLinkParams: true });

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
  }, [deepLinkedEventId, deepLinkedFormId, isAuthResolved, role, router, navigateToMenu]);

  useEffect(() => {
    if (!role || !isExecutive(role)) {
      setHasPendingRSVP(false);
      return;
    }

    const checkEvents = async () => {
      try {
        const response = await fetch("/api/events");
        if (response.ok) {
          const data = await response.json();
          const events = data.events || [];

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

  // Grouped navigation: a handful of direct tabs plus labeled dropdown groups.
  // Every visibility condition is preserved verbatim from the previous flat list.
  const navEntries = useMemo<NavEntry[]>(() => {
    const explore: MenuItem[] = [
      { key: "all_courses_table", label: "Courses table" },
      { key: "our_team", label: "Our team" },
      { key: "donation_history", label: "Donation history" },
      { key: "sponsors", label: "For Sponsors" },
    ];

    const teaching: MenuItem[] = [];
    if (role && canManageCourses(role)) {
      teaching.push({ key: "manage_courses", label: "My courses" });
      // Single unified requests page (founders will have approve/reject controls)
      teaching.push({ key: "manage_course_requests", label: "Course requests" });
    }
    if (isExecutive(role)) {
      teaching.push({ key: "events", label: "Events" });
    }
    if (isFounder(role) || (isExecutive(role) && (hasForms || active === "forms"))) {
      teaching.push({ key: "forms", label: "Forms" });
    }

    const admin: MenuItem[] = [];
    if (isFounder(role)) {
      admin.push({ key: "founder_tools", label: "Manage accounts" });
      admin.push({ key: "manage_enrollments", label: "Manage enrollments" });
    }
    if (role && isHighRankingChiefExecutive(role)) {
      admin.push({ key: "emails", label: "Emails" });
      admin.push({ key: "withdrawals", label: "Withdraw hours" });
      admin.push({ key: "site_settings", label: "Site Settings" });
    }
    if (isFounder(role)) {
      admin.push({ key: "analytics", label: "Analytics" });
      admin.push({ key: "roles_manager", label: "Roles" });
    }
    // Founders/high-level roles should always see trash if there is something in it
    if (trashCount > 0 && (!isExecutive(role) || isFounder(role))) {
      admin.push({ key: "trash", label: "Trash" });
    }

    const entries: NavEntry[] = [
      { type: "item", item: { key: "home", label: "Home" } },
      { type: "item", item: { key: "all_courses", label: "Courses" } },
    ];
    if (role) {
      entries.push({ type: "item", item: { key: "my_classes", label: "My classes" } });
      entries.push({ type: "item", item: { key: "enrolled_courses", label: "My enrollments" } });
    }
    entries.push({ type: "group", key: "explore", label: "Explore", items: explore });
    if (teaching.length > 0) {
      entries.push({ type: "group", key: "teaching", label: "Teaching", items: teaching });
    }
    if (admin.length > 0) {
      entries.push({ type: "group", key: "admin", label: "Admin", items: admin });
    }
    entries.push({ type: "item", item: { key: "help", label: "Help" } });
    return entries;
  }, [role, hasForms, trashCount, active]);

  const menus = useMemo<MenuItem[]>(
    () => navEntries.flatMap((entry) => (entry.type === "item" ? [entry.item] : entry.items)),
    [navEntries]
  );

  const activeMenu: MenuKey = menus.some((item) => item.key === active)
    ? active
    : "home";

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
          <EventReminderBanner onAction={() => navigateToMenu("events")} />
        </div>
      )}
      <div className="sticky top-0 z-20 -mx-6 border-b border-[var(--border)] bg-[var(--background)]/90 px-6 backdrop-blur">
        <nav className="scrollbar-hide flex overflow-x-auto">
          {navEntries.map((entry) => {
            // A group that ends up with a single item renders as a plain tab.
            const singleItem =
              entry.type === "item"
                ? entry.item
                : entry.items.length === 1
                  ? entry.items[0]
                  : null;
            if (singleItem) {
              return (
                <button
                  key={singleItem.key}
                  type="button"
                  onClick={() => {
                    navigateToMenu(singleItem.key);
                    if (singleItem.key === "home") {
                      document.getElementById("home")?.scrollIntoView({
                        behavior: "smooth",
                      });
                    }
                  }}
                  className={
                    activeMenu === singleItem.key
                      ? "whitespace-nowrap border-b-2 border-[var(--foreground)] px-4 py-3 text-xs font-bold text-[var(--foreground)] transition-colors"
                      : "whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  }
                >
                  {singleItem.label}
                </button>
              );
            }
            const group = entry as Extract<NavEntry, { type: "group" }>;
            return (
              <NavDropdown
                key={group.key}
                label={group.label}
                items={group.items}
                activeKey={activeMenu}
                onSelect={(key) => navigateToMenu(key)}
              />
            );
          })}
        </nav>
      </div>

      {activeMenu === "home" ? <HomeMenu isSignedIn={Boolean(role)} onOpenTeamTab={() => navigateToMenu("our_team")} /> : null}
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
      {activeMenu === "emails" ? <EmailHistoryMenu /> : null}
      {activeMenu === "withdrawals" ? <WithdrawHoursMenu /> : null}
      {activeMenu === "help" ? <HelpMenu /> : null}
      {activeMenu === "events" ? <EventsMenu /> : null}
      {activeMenu === "forms" ? <FormsMenu /> : null}
      {activeMenu === "trash" ? <ManageMyCoursesMenu isTrashMode={true} /> : null}
      {activeMenu === "roles_manager" ? <RolesManagerMenu /> : null}
      {activeMenu === "sponsors" ? <SponsorsMenu /> : null}
      {activeMenu === "site_settings" ? <SiteSettingsMenu /> : null}
      {activeMenu === "analytics" ? <AnalyticsMenu /> : null}

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
