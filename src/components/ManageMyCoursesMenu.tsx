"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentUser, onAuthChange } from "@/lib/authClient";
import { canManageCourses, isExecutive, isFounder, isHighRankingChiefExecutive, resolveUserRole, type UserRole } from "@/lib/roles";
import { setHasUnsavedData } from "@/lib/unsavedData";
import { MarkdownText } from "@/lib/parseMarkdown";

type EnrolledStudent = {
  id: string;
  student_id: string;
  student_name?: string | null;
  student_email?: string | null;
  student_grade?: string | null;
  student_school?: string | null;
  created_at: string;
};

type CourseClass = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number;
  created_at: string;
};

type Course = {
  id: string;
  title: string;
  short_name?: string | null;
  description: string | null;
  is_completed?: boolean;
  completed_start_date?: string | null;
  completed_end_date?: string | null;
  completed_class_count?: number | null;
  max_students?: number | null;
  donation_fee?: number | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
  course_classes: CourseClass[];
  course_enrollments: EnrolledStudent[];
};

type AvailableTutor = {
  id: string;
  fullName: string;
  email: string;
};

const getCourseLastClassTime = (course: Course) => {
  if (course.is_completed && course.completed_end_date) {
    const completedAt = new Date(`${course.completed_end_date}T00:00:00`);
    return completedAt.getTime();
  }

  const classStarts = (course.course_classes ?? [])
    .map((item) => new Date(item.starts_at).getTime())
    .filter((value) => Number.isFinite(value));
  if (classStarts.length > 0) {
    return Math.max(...classStarts);
  }

  return Number.NEGATIVE_INFINITY;
};

const sortCoursesByCreationDateDesc = (left: Course, right: Course) => {
  const leftCreated = new Date(left.created_at).getTime();
  const rightCreated = new Date(right.created_at).getTime();
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }
  }

  return left.title.localeCompare(right.title);
};

const sortCoursesByFirstClassDesc = (left: Course, right: Course) => {
  const getFirstClassTime = (course: Course) => {
    if (course.is_completed && course.completed_start_date) {
      const completedAt = new Date(`${course.completed_start_date}T00:00:00`);
      return completedAt.getTime();
    }

    const classStarts = (course.course_classes ?? [])
      .map((item) => new Date(item.starts_at).getTime())
      .filter((value) => Number.isFinite(value));
    if (classStarts.length > 0) {
      return Math.min(...classStarts);
    }

    return Number.NEGATIVE_INFINITY;
  };

  const leftFirst = getFirstClassTime(left);
  const rightFirst = getFirstClassTime(right);

  if (leftFirst !== rightFirst) {
    return rightFirst - leftFirst; // Latest first
  }

  return sortCoursesByCreationDateDesc(left, right);
};





type StatusState = {
  type: "idle" | "error" | "success";
  message: string;
};



const snapDateTimeLocalToFiveMinutes = (value: string) => {
  return value;
};

const isFiveMinuteLocal = (value: string) => {
  return true;
};

export default function ManageMyCoursesMenu({ isTrashMode = false }: { isTrashMode?: boolean }) {
  const [role, setRole] = useState<UserRole | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [donationLink, setDonationLink] = useState<string>("");
  const [donationRaised, setDonationRaised] = useState<number | null>(null);
  const [taughtMinutes, setTaughtMinutes] = useState<number | null>(null);

  const [classStartsAt, setClassStartsAt] = useState<Record<string, string>>({});
  const [classDurationMinutes, setClassDurationMinutes] = useState<Record<string, string>>({});
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [copiedCourseId, setCopiedCourseId] = useState<string | null>(null);
  const [editCourseTitle, setEditCourseTitle] = useState("");
  const [editCourseShortName, setEditCourseShortName] = useState("");
  const [editCourseDescription, setEditCourseDescription] = useState("");
  const [editCourseMaxStudents, setEditCourseMaxStudents] = useState<string>("");
  const [editCourseDonationFee, setEditCourseDonationFee] = useState<string>("");
  const [editCompletedStartDate, setEditCompletedStartDate] = useState("");
  const [editCompletedEndDate, setEditCompletedEndDate] = useState("");
  const [editCompletedClassCount, setEditCompletedClassCount] = useState("");
  const [isRestoringId, setIsRestoringId] = useState<string | null>(null);
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);
  const [bulkTutorEmail, setBulkTutorEmail] = useState("");
  const [isBulkSetting, setIsBulkSetting] = useState(false);
  const [isEnforcingTutors, setIsEnforcingTutors] = useState(false);

  const [pendingCourseEditId, setPendingCourseEditId] = useState<string | null>(
    null
  );
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editDurationMinutes, setEditDurationMinutes] = useState("");
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const [pendingClassDeleteId, setPendingClassDeleteId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingEnrollmentDeleteId, setPendingEnrollmentDeleteId] = useState<
    string | null
  >(null);

  const [status, setStatus] = useState<StatusState>({
    type: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTutors, setAvailableTutors] = useState<AvailableTutor[]>([]);
  const [pendingTutorCourseId, setPendingTutorCourseId] = useState<string | null>(null);
  const [isManualEnrollOpen, setIsManualEnrollOpen] = useState(false);
  const [enrollCourseId, setEnrollCourseId] = useState<string | null>(null);
  const [allStudents, setAllStudents] = useState<{ id: string; fullName: string; email: string }[]>([]);
  const [enrollUserId, setEnrollUserId] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState("");

  useEffect(() => {
    const hasUnsavedCourseEdit = editingCourseId !== null;
    const hasUnsavedClassEdit = editingClassId !== null;
    const hasUnsavedClassCreation =
      Object.values(classStartsAt).some((val) => val.trim().length > 0);
    const hasUnsavedData =
      hasUnsavedCourseEdit || hasUnsavedClassEdit || hasUnsavedClassCreation;

    setHasUnsavedData("manage-courses", hasUnsavedData);
    return () => setHasUnsavedData("manage-courses", false);
  }, [editingCourseId, editingClassId, classStartsAt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const formatCompletedDate = (value?: string | null) => {
    if (!value) {
      return "Unknown";
    }
    const [y, m, d] = value.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString();
  };

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) {
        setRole(null);
        return;
      }

      const resolvedRole = resolveUserRole(
        user.email,
        user.role ?? null
      );
      setRole(resolvedRole);
    };

    load();
    return onAuthChange(load);
  }, []);



  useEffect(() => {
    if (!role || !canManageCourses(role)) {
      return;
    }

    const fetchCourses = async () => {
      setIsLoading(true);
      setStatus({ type: "idle", message: "" });

      const url = isTrashMode ? "/api/courses?trash=true" : "/api/my-courses";
      const response = await fetch(url);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          type: "error",
          message: payload?.error ?? "Unable to load courses.",
        });
        setIsLoading(false);
        return;
      }

      const data = (await response.json()) as { courses: Course[] };
      setCourses(data.courses ?? []);
      setIsLoading(false);
    };

    fetchCourses();
  }, [role, isTrashMode]);

  useEffect(() => {
    if (!isExecutive(role)) {
      return;
    }

    const loadDonationLink = async () => {
      const response = await fetch("/api/tutor-profile");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        donationLink?: string;
        donationProgress?: {
          raised?: number | null;
        };
        taughtMinutes?: number;
      };
      setDonationLink(data.donationLink ?? "");
      setDonationRaised(
        typeof data.donationProgress?.raised === "number"
          ? data.donationProgress.raised
          : null
      );
      setTaughtMinutes(
        typeof data.taughtMinutes === "number"
          ? data.taughtMinutes
          : null
      );
    };

    loadDonationLink();
  }, [role]);

  useEffect(() => {
    if (!isFounder(role)) {
      return;
    }

    const loadTutors = async () => {
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        users: { id: string; fullName: string; email: string; role: string }[];
      };
      const tutors = (data.users ?? [])
        .filter((u) => isExecutive(u.role as any))
        .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
      setAvailableTutors(tutors);

      const students = (data.users ?? [])
        .filter((u) => u.role === "student")
        .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email }));
      setAllStudents(students);
    };

    loadTutors();
  }, [role]);



  const toLocalDateTimeInputValue = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const sortClassesByStart = (classes: CourseClass[]) =>
    [...classes].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

  const getSuggestedStartValue = (course: Course) => {
    if (!course.course_classes || course.course_classes.length === 0) {
      return "";
    }

    const sorted = [...course.course_classes].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );
    const latest = sorted[sorted.length - 1];

    const suggested = new Date(latest.starts_at);
    
    if (sorted.length === 1) {
      suggested.setDate(suggested.getDate() + 7);
    } else {
      const secondLatest = sorted[sorted.length - 2];
      const diffMs = new Date(latest.starts_at).getTime() - new Date(secondLatest.starts_at).getTime();
      suggested.setTime(suggested.getTime() + diffMs);
    }

    return snapDateTimeLocalToFiveMinutes(
      toLocalDateTimeInputValue(suggested)
    );
  };

  const onCreateClass = async (
    courseId: string,
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });

    const course = courses.find((item) => item.id === courseId);
    const titleValue = `Class ${(course?.course_classes?.length ?? 0) + 1}`;
    const startsAtValue =
      classStartsAt[courseId] || (course ? getSuggestedStartValue(course) : "");

    if (!startsAtValue) {
      setStatus({ type: "error", message: "Class date/time is required." });
      return;
    }
    if (!isFiveMinuteLocal(startsAtValue)) {
      setStatus({
        type: "error",
        message:
          "Class date/time is invalid.",
      });
      return;
    }

    setPendingCourseId(courseId);
    const response = await fetch(`/api/courses/${courseId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleValue,
        startsAt: new Date(startsAtValue).toISOString(),
        durationHours: classDurationMinutes[courseId] ? Number.parseInt(classDurationMinutes[courseId]) / 60 : 1,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to create class.",
      });
      setPendingCourseId(null);
      return;
    }

    const payload = (await response.json()) as { class: CourseClass };
    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === courseId
          ? {
            ...courseItem,
            course_classes: [...(courseItem.course_classes ?? []), payload.class],
          }
          : courseItem
      )
    );

    setClassStartsAt((current) => ({ ...current, [courseId]: "" }));
    setClassDurationMinutes((current) => ({ ...current, [courseId]: "" }));
    setStatus({ type: "success", message: "Class added." });
    setPendingCourseId(null);
  };

  const startEditClass = (courseClass: CourseClass) => {
    setEditingClassId(courseClass.id);
    setEditStartsAt(
      toLocalDateTimeInputValue(new Date(courseClass.starts_at))
    );
    setEditDurationMinutes(
      typeof courseClass.duration_hours === "number"
        ? String(Math.round(courseClass.duration_hours * 60))
        : String(Math.round((courseClass.duration_hours || 1) * 60))
    );
  };

  const cancelEditClass = () => {
    setEditingClassId(null);
    setEditStartsAt("");
    setEditDurationMinutes("");
  };

  const saveClassEdit = async () => {
    if (!editingClassId) {
      return;
    }

    setPendingClassId(editingClassId);
    setStatus({ type: "idle", message: "" });

    if (editStartsAt && !isFiveMinuteLocal(editStartsAt)) {
      setStatus({
        type: "error",
        message:
          "Class date/time is invalid.",
      });
      setPendingClassId(null);
      return;
    }

    let bulkClassUpdates: { classId: string; startsAt: string }[] | undefined;

    let targetCourse: Course | undefined;
    let targetClass: CourseClass | undefined;
    for (const c of courses) {
      const cls = c.course_classes?.find((cc) => cc.id === editingClassId);
      if (cls) {
        targetCourse = c;
        targetClass = cls;
        break;
      }
    }

    if (
      targetCourse &&
      !targetCourse.is_completed &&
      targetClass &&
      editStartsAt
    ) {
      const oldTime = new Date(targetClass.starts_at);
      const newTime = new Date(editStartsAt);

      const oldDateStr = oldTime.toLocaleDateString();
      const newDateStr = newTime.toLocaleDateString();

      const timeDiffMs = newTime.getTime() - oldTime.getTime();

      const oldDuration = typeof targetClass.duration_hours === "number" ? targetClass.duration_hours : Number.parseFloat(String(targetClass.duration_hours || 1));
      const newDuration = editDurationMinutes ? Number.parseInt(editDurationMinutes) / 60 : undefined;
      const durationChanged = newDuration !== undefined && newDuration !== oldDuration;

      const timeChanged = oldDateStr === newDateStr && timeDiffMs !== 0;

      if (timeChanged || durationChanged) {
        const subsequentClasses = (targetCourse.course_classes ?? []).filter(
          (c) => new Date(c.starts_at).getTime() > oldTime.getTime()
        );

        if (subsequentClasses.length > 0) {
          const actionText = timeChanged && durationChanged
            ? "time and duration"
            : timeChanged
            ? "time"
            : "duration";

          const confirmShift = window.confirm(
            `You changed the ${actionText} of this class. Do you want to apply this same change to all ${subsequentClasses.length} subsequent classes in this course?`
          );
          if (confirmShift) {
            const [, newTimePart] = editStartsAt.split("T");
            
            bulkClassUpdates = subsequentClasses.map((subClass) => {
              const localStr = toLocalDateTimeInputValue(new Date(subClass.starts_at));
              const [localDatePart] = localStr.split("T");
              const newLocalStr = `${localDatePart}T${newTimePart}`;
              return {
                classId: subClass.id,
                startsAt: timeChanged ? new Date(newLocalStr).toISOString() : undefined,
                durationHours: durationChanged ? newDuration : undefined,
              } as any; // Type assertion since our type definition earlier didn't explicitly add durationHours but the API expects it
            });
          }
        }
      }
    }

    const response = await fetch(`/api/classes/${editingClassId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: editStartsAt ? new Date(editStartsAt).toISOString() : undefined,
        durationHours: editDurationMinutes ? Number.parseInt(editDurationMinutes) / 60 : undefined,
        bulkClassUpdates,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to update class.",
      });
      setPendingClassId(null);
      return;
    }

    const payload = (await response.json()) as { 
      class: CourseClass;
      updatedClasses?: CourseClass[];
    };
    
    setCourses((current) =>
      current.map((courseItem) => {
        if (!courseItem.course_classes?.some((c) => c.id === payload.class.id)) {
          return courseItem;
        }

        const updatedMap = new Map((payload.updatedClasses || [payload.class]).map(c => [c.id, c]));

        return {
          ...courseItem,
          course_classes: (courseItem.course_classes ?? []).map((courseClass) =>
            updatedMap.get(courseClass.id) || courseClass
          ),
        };
      })
    );
    setStatus({ type: "success", message: "Class updated." });
    setPendingClassId(null);
    cancelEditClass();
  };

  const deleteClass = async (courseId: string, courseClass: CourseClass) => {
    const name = courseClass.title || "this class";
    const firstConfirm = window.confirm(
      `Are you sure you want to delete "${name}"? This cannot be undone.`
    );
    if (!firstConfirm) {
      return;
    }

    setPendingClassDeleteId(courseClass.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch(`/api/classes/${courseClass.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to delete class.",
      });
      setPendingClassDeleteId(null);
      return;
    }

    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === courseId
          ? {
            ...courseItem,
            course_classes: (courseItem.course_classes ?? []).filter(
              (c) => c.id !== courseClass.id
            ),
          }
          : courseItem
      )
    );
    window.dispatchEvent(new CustomEvent("refresh-trash"));
    setStatus({ type: "success", message: "Class deleted." });
    setPendingClassDeleteId(null);
  };

  const deleteCourse = async (course: Course) => {
    if (!role || !canManageCourses(role)) {
      return;
    }

    if (isTrashMode && !isFounder(role)) {
      return;
    }

    const name = course.title || "this course";
    
    if (isTrashMode) {
      const firstConfirm = window.confirm(
        `Are you sure you want to PERMANENTLY delete "${name}"? This action cannot be undone.`
      );
      if (!firstConfirm) return;

      const secondConfirm = window.confirm(
        `Final confirmation: Type "DELETE" to permanently remove "${name}".`
      );
      if (secondConfirm !== true && window.prompt(`Type "DELETE" to confirm`) !== "DELETE") {
        return;
      }
    } else {
      const firstConfirm = window.confirm(
        `Are you sure you want to move "${name}" to the trash? You can restore it later from the Trash tab.`
      );
      if (!firstConfirm) return;
    }

    setPendingDeleteId(course.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        courseId: course.id,
        permanent: isTrashMode
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to delete course.",
      });
      setPendingDeleteId(null);
      return;
    }

    setCourses((current) =>
      current.filter((courseItem) => courseItem.id !== course.id)
    );
    window.dispatchEvent(new CustomEvent("refresh-trash"));
    setStatus({ 
      type: "success", 
      message: isTrashMode ? "Course permanently deleted." : "Course moved to trash." 
    });
    setPendingDeleteId(null);
  };

  const restoreCourse = async (courseId: string) => {
    setIsRestoringId(courseId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, restore: true }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus({ type: "error", message: payload?.error ?? "Failed to restore course." });
      setIsRestoringId(null);
      return;
    }

    setCourses(current => current.filter(c => c.id !== courseId));
    window.dispatchEvent(new CustomEvent("refresh-trash"));
    setStatus({ type: "success", message: "Course restored successfully." });
    setIsRestoringId(null);
  };

  const emptyTrash = async () => {
    if (!isFounder(role)) return;
    
    const confirm1 = window.confirm("Are you sure you want to empty the trash? ALL trashed courses will be permanently deleted.");
    if (!confirm1) return;

    const confirm2 = window.confirm("This action is IRREVERSIBLE. Are you ABSOLUTELY sure?");
    if (!confirm2) return;

    setIsEmptyingTrash(true);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: "all_trash" }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus({ type: "error", message: payload?.error ?? "Failed to empty trash." });
      setIsEmptyingTrash(false);
      return;
    }

    setCourses([]);
    window.dispatchEvent(new CustomEvent("refresh-trash"));
    setStatus({ type: "success", message: "Trash emptied successfully." });
    setIsEmptyingTrash(false);
  };

  const handleBulkSetTutor = async () => {
    if (!bulkTutorEmail.trim()) {
      setStatus({ type: "error", message: "Please enter an email address." });
      return;
    }
    const confirm = window.confirm(`Are you sure you want to assign all limbo courses to ${bulkTutorEmail}?`);
    if (!confirm) return;

    setIsBulkSetting(true);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/bulk-set-tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: bulkTutorEmail }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus({ type: "error", message: payload?.error ?? "Failed to bulk assign tutors." });
      setIsBulkSetting(false);
      return;
    }

    setStatus({ type: "success", message: "Successfully assigned limbo courses." });
    setBulkTutorEmail("");
    setIsBulkSetting(false);

    // Refresh courses
    const fetchCourses = async () => {
      const resp = await fetch(isTrashMode ? "/api/courses?trash=true" : "/api/my-courses");
      if (resp.ok) {
        const data = await resp.json();
        setCourses(data.courses ?? []);
      }
    };
    fetchCourses();
  };

  const handleEnforceTutors = async () => {
    const confirm = window.confirm("Are you sure you want to enforce the limbo courses rule? This will retroactively convert all courses managed by non-tutors into limbo courses.");
    if (!confirm) return;

    setIsEnforcingTutors(true);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/enforce-tutors", {
      method: "POST",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus({ type: "error", message: payload?.error ?? "Failed to enforce tutor rule." });
      setIsEnforcingTutors(false);
      return;
    }

    const payload = await response.json();
    setStatus({ type: "success", message: `Successfully enforced rule. ${payload.count} courses converted to limbo.` });
    setIsEnforcingTutors(false);

    // Refresh courses
    const fetchCourses = async () => {
      const resp = await fetch(isTrashMode ? "/api/courses?trash=true" : "/api/my-courses");
      if (resp.ok) {
        const data = await resp.json();
        setCourses(data.courses ?? []);
      }
    };
    fetchCourses();
  };

  const startEditCourse = (course: Course) => {
    setEditingCourseId(course.id);
    setEditCourseTitle(course.title ?? "");
    setEditCourseShortName(course.short_name ?? "");
    setEditCourseDescription(course.description ?? "");
    setEditCourseMaxStudents(course.max_students ? String(course.max_students) : "");
    setEditCourseDonationFee(course.donation_fee ? String(course.donation_fee) : "");
    setEditCompletedStartDate(course.completed_start_date ?? "");
    setEditCompletedEndDate(course.completed_end_date ?? "");
    setEditCompletedClassCount(course.completed_class_count ? String(course.completed_class_count) : "");
  };

  const cancelEditCourse = () => {
    setEditingCourseId(null);
    setEditCourseTitle("");
    setEditCourseShortName("");
    setEditCourseDescription("");
    setEditCourseMaxStudents("");
    setEditCourseDonationFee("");
    setEditCompletedStartDate("");
    setEditCompletedEndDate("");
    setEditCompletedClassCount("");
  };

  const saveCourseEdit = async (courseId: string) => {
    const titleValue = editCourseTitle.trim();

    if (!titleValue) {
      setStatus({ type: "error", message: "Course title is required." });
      return;
    }


    setPendingCourseEditId(courseId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId,
        title: titleValue,
        shortName: isFounder(role) ? editCourseShortName.trim() : undefined,
        description: editCourseDescription.trim(),
        maxStudents: isFounder(role) ? (editCourseMaxStudents ? Number(editCourseMaxStudents) : null) : undefined,
        donationFee: isHighRankingChiefExecutive(role) ? (editCourseDonationFee ? Number(editCourseDonationFee) : null) : undefined,
        completedStartDate: isFounder(role) ? (editCompletedStartDate || null) : undefined,
        completedEndDate: isFounder(role) ? (editCompletedEndDate || null) : undefined,
        completedClassCount: isFounder(role) ? (editCompletedClassCount ? Number(editCompletedClassCount) : null) : undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to update course.",
      });
      setPendingCourseEditId(null);
      return;
    }

    const payload = (await response.json()) as { course: Course };
    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === payload.course.id
          ? { ...courseItem, ...payload.course }
          : courseItem
      )
    );
    setStatus({ type: "success", message: "Course updated." });
    setPendingCourseEditId(null);
    cancelEditCourse();
  };

  const removeEnrolledStudent = async (
    courseId: string,
    student: EnrolledStudent
  ) => {
    if (!isFounder(role)) {
      return;
    }

    const studentLabel = student.student_name || student.student_email || "student";
    const firstConfirm = window.confirm(
      `Remove ${studentLabel} from this course?`
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(
      `Please confirm again to remove ${studentLabel} from this course.`
    );
    if (!secondConfirm) {
      return;
    }

    setPendingEnrollmentDeleteId(student.id);
    setStatus({ type: "idle", message: "" });

    const response = await fetch(`/api/course-enrollments/${student.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to remove enrolled student.",
      });
      setPendingEnrollmentDeleteId(null);
      return;
    }

    setCourses((current) =>
      current.map((course) =>
        course.id === courseId
          ? {
            ...course,
            course_enrollments: (course.course_enrollments ?? []).filter(
              (enrollment) => enrollment.id !== student.id
            ),
          }
          : course
      )
    );
    setStatus({
      type: "success",
      message: `Removed ${studentLabel} from the course.`,
    });
    setPendingEnrollmentDeleteId(null);
  };

  const changeTutor = async (courseId: string, tutorId: string) => {
    setPendingTutorCourseId(courseId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, createdBy: tutorId }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to change tutor.",
      });
      setPendingTutorCourseId(null);
      return;
    }

    const payload = (await response.json()) as { course: Course };
    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === payload.course.id
          ? { ...courseItem, ...payload.course }
          : courseItem
      )
    );
    setStatus({ type: "success", message: "Tutor updated." });
    setPendingTutorCourseId(null);
  };

  const onManualEnroll = async () => {
    if (!enrollCourseId || !enrollUserId) return;
    setIsEnrolling(true);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: enrollUserId, courseId: enrollCourseId }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setStatus({ type: "error", message: payload?.error ?? "Failed to enroll student." });
      setIsEnrolling(false);
      return;
    }

    setStatus({ type: "success", message: "Student enrolled successfully." });
    setIsEnrolling(false);
    setIsManualEnrollOpen(false);
    setEnrollUserId("");
    
    // Refresh course data
    const fetchCourses = async () => {
      const resp = await fetch("/api/my-courses");
      if (resp.ok) {
        const data = await resp.json();
        setCourses(data.courses ?? []);
      }
    };
    fetchCourses();
  };

  const removeTutor = async (courseId: string) => {
    const confirmed = window.confirm(
      "Remove the tutor from this course? The course will become a limbo course."
    );
    if (!confirmed) {
      return;
    }

    setPendingTutorCourseId(courseId);
    setStatus({ type: "idle", message: "" });

    const response = await fetch("/api/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, createdBy: null }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStatus({
        type: "error",
        message: payload?.error ?? "Unable to remove tutor.",
      });
      setPendingTutorCourseId(null);
      return;
    }

    const payload = (await response.json()) as { course: Course };
    setCourses((current) =>
      current.map((courseItem) =>
        courseItem.id === payload.course.id
          ? { ...courseItem, ...payload.course }
          : courseItem
      )
    );
    setStatus({ type: "success", message: "Tutor removed. Course is now in limbo." });
    setPendingTutorCourseId(null);
  };

  const orderedCourses = useMemo(
    () =>
      [...courses].sort((left, right) => {
        const isLeftCompleted = Boolean(left.is_completed);
        const isRightCompleted = Boolean(right.is_completed);

        if (!isLeftCompleted && !isRightCompleted) {
          return sortCoursesByCreationDateDesc(left, right);
        }
        if (isLeftCompleted && isRightCompleted) {
          return sortCoursesByFirstClassDesc(left, right);
        }
        if (!isLeftCompleted && isRightCompleted) {
          return -1;
        }
        return 1;
      }),
    [courses]
  );

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) {
      return orderedCourses;
    }

    const query = searchQuery.toLowerCase().replace(/[\u202F\u00A0]/g, " ");

    return orderedCourses.filter((course) => {
      if (course.title.toLowerCase().replace(/[\u202F\u00A0]/g, " ").includes(query)) return true;
      if (course.description?.toLowerCase().includes(query)) return true;
      if (
        (course.created_by_name || "Unknown tutor").toLowerCase().includes(query)
      )
        return true;
      if (course.created_by_email?.toLowerCase().includes(query)) return true;

      if (course.course_classes && course.course_classes.length > 0) {
        for (const courseClass of course.course_classes) {
          try {
            const classDate = new Date(courseClass.starts_at);
            const formatTime = (d: Date) => 
              d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/[\u202F\u00A0]/g, ' ');
              
            const dateString = classDate.toLocaleString().toLowerCase().replace(/[\u202F\u00A0]/g, ' ');
            const dateString2 = classDate.toLocaleDateString().toLowerCase().replace(/[\u202F\u00A0]/g, ' ');
            const timeString = formatTime(classDate);
            
            const durationHours = typeof courseClass.duration_hours === 'number' 
              ? courseClass.duration_hours 
              : Number.parseFloat(String(courseClass.duration_hours || "1"));
            const endDate = new Date(classDate.getTime() + (Number.isNaN(durationHours) ? 1 : durationHours) * 60 * 60 * 1000);
            const endTimeString = formatTime(endDate);

            if (
              dateString.includes(query) || 
              dateString2.includes(query) || 
              timeString.includes(query) ||
              endTimeString.includes(query)
            ) {
               return true;
            }
          } catch (e) {
            // ignore parsing errors
          }
        }
      }

      return false;
    });
  }, [orderedCourses, searchQuery]);

  if (!role || !canManageCourses(role)) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Courses
        </p>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {isTrashMode ? "Trash" : "Manage my courses"}
          </h2>
          {isTrashMode && isFounder(role) && courses.length > 0 && (
            <button
              onClick={emptyTrash}
              disabled={isEmptyingTrash}
              className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500 transition hover:border-red-400 disabled:opacity-50"
            >
              {isEmptyingTrash ? "Emptying..." : "Empty Trash"}
            </button>
          )}
          {!isTrashMode && isExecutive(role) ? (
            <div className="flex flex-col items-end gap-1">
              {donationLink && donationRaised !== null ? (
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  ${donationRaised.toLocaleString()} raised
                </p>
              ) : null}
              {taughtMinutes !== null ? (
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {taughtMinutes} minutes taught
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {!isTrashMode && (
          <div className="flex flex-col gap-1">
            {isExecutive(role) && donationLink ? (
              <a
                href={donationLink}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-[var(--foreground)] underline"
              >
                Your donation link
              </a>
            ) : null}
            <a
              href="https://forms.gle/WXrRhDtAv2CH5Chx6"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[var(--foreground)] underline"
            >
              Tutor Log Form
            </a>
            {isFounder(role) && (
              <div className="mt-4 flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--foreground)]">Admin Tools</p>
                    <button
                      type="button"
                      disabled={isEnforcingTutors}
                      onClick={handleEnforceTutors}
                      className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:opacity-50"
                    >
                      {isEnforcingTutors ? "Enforcing..." : "Enforce Limbo Rule on Existing Courses"}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)]">Assign all limbo courses to a specific tutor email:</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="email"
                      placeholder="Tutor's email address"
                      value={bulkTutorEmail}
                      onChange={(e) => setBulkTutorEmail(e.target.value)}
                      className="flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    />
                    <button
                      type="button"
                      disabled={isBulkSetting}
                      onClick={handleBulkSetTutor}
                      className="rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:opacity-50"
                    >
                      {isBulkSetting ? "Assigning..." : "Assign to Email"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {status.type === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {status.message}
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading courses...</p>
      ) : null}

      {!isLoading && courses.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No courses available yet.
        </p>
      ) : null}

      {!isLoading && courses.length > 0 ? (
        <div className="relative mb-6">
          <input
            type="text"
            placeholder="Search courses by name, description, tutor, or dates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 pl-10 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
          />
          <svg
            className="absolute left-3 top-3.5 h-4 w-4 text-[var(--muted)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      ) : null}

      <div className="space-y-3">
        {filteredCourses.map((course) => {
          const ongoing = (course.course_classes ?? []).some((cls) => {
            const start = new Date(cls.starts_at).getTime();
            if (Number.isNaN(start)) return false;
            const end = start + (cls.duration_hours || 1) * 60 * 60 * 1000;
            return nowMs >= start && nowMs <= end;
          });
          
          return (
            <div
              key={course.id}
              className={`space-y-4 rounded-xl border px-4 py-4 ${
                ongoing ? "border-amber-400 animate-pulse" : "border-[var(--border)]"
              }`}
            >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1">
                {editingCourseId === course.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editCourseTitle}
                      onChange={(event) =>
                        setEditCourseTitle(event.target.value)
                      }
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    />
                    <textarea
                      value={editCourseDescription}
                      onChange={(event) =>
                        setEditCourseDescription(event.target.value)
                      }
                      rows={3}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    />
                    <p className="px-1 text-xs text-[var(--muted)]">Markdown is supported for formatting</p>
                    {isFounder(role) ? (
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={editCourseMaxStudents}
                        onChange={(event) =>
                          setEditCourseMaxStudents(event.target.value)
                        }
                        placeholder="Max Students (Leave blank for unlimited)"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                      />
                    ) : null}
                    {isHighRankingChiefExecutive(role) ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editCourseDonationFee}
                        onChange={(event) => setEditCourseDonationFee(event.target.value)}
                        placeholder="Donation Fee (Leave blank for none)"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                      />
                    ) : null}
                    {isFounder(role) ? (
                      <input
                        type="text"
                        value={editCourseShortName}
                        onChange={(event) =>
                          setEditCourseShortName(event.target.value)
                        }
                        placeholder="Short name (optional)"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                      />
                    ) : null}
                    {isFounder(role) && course.is_completed ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1">
                          <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                            Start date
                          </label>
                          <input
                            type="date"
                            value={editCompletedStartDate}
                            onChange={(event) => setEditCompletedStartDate(event.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                            End date
                          </label>
                          <input
                            type="date"
                            value={editCompletedEndDate}
                            onChange={(event) => setEditCompletedEndDate(event.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                            Classes
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editCompletedClassCount}
                            onChange={(event) => setEditCompletedClassCount(event.target.value)}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {course.title}
                    </p>
                    {isFounder(role) && course.short_name ? (
                      <p className="text-xs text-[var(--muted)]">
                        Short name: {course.short_name}
                      </p>
                    ) : null}
                    {course.description ? (
                      <div className="text-xs text-[var(--muted)]">
                        <MarkdownText text={course.description} />
                        {isTrashMode ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(course.description || "");
                                  setCopiedCourseId(course.id);
                                  window.setTimeout(() => setCopiedCourseId(null), 2000);
                                } catch (e) {
                                  // ignore clipboard errors
                                }
                              }}
                              className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.7rem] font-semibold"
                            >
                              {copiedCourseId === course.id ? "Copied!" : "Copy description"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {isFounder(role) ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-[var(--muted)]">
                          Tutor:{" "}
                          <span className={course.created_by_name || course.created_by_email ? "" : "font-semibold text-amber-500"}>
                            {course.created_by_name ||
                              course.created_by_email ||
                              "Not Determined"}
                          </span>
                        </p>
                        {!isTrashMode && (
                          <>
                            {course.created_by ? (
                              <button
                                type="button"
                                disabled={pendingTutorCourseId === course.id}
                                onClick={() => removeTutor(course.id)}
                                className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                {pendingTutorCourseId === course.id ? "Removing..." : "Remove Tutor"}
                              </button>
                            ) : null}
                            <select
                              disabled={pendingTutorCourseId === course.id}
                              value={course.created_by ?? ""}
                              onChange={(event) => {
                                if (event.target.value) {
                                  changeTutor(course.id, event.target.value);
                                }
                              }}
                              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[0.6rem] text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              <option value="">Set tutor...</option>
                              {availableTutors.map((tutor) => (
                                <option key={tutor.id} value={tutor.id}>
                                  {tutor.fullName || tutor.email}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    ) : null}
                    {isFounder(role) && course.max_students ? (
                      <p className="text-xs text-[var(--muted)]">
                        Max Students: {course.max_students}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
              {isFounder(role) && (
                <div className="flex flex-wrap items-center gap-2">
                  {isTrashMode ? (
                    <button
                    type="button"
                    disabled={isRestoringId === course.id}
                    onClick={() => restoreCourse(course.id)}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:opacity-50"
                  >
                    {isRestoringId === course.id ? "Restoring..." : "Restore"}
                  </button>
                ) : editingCourseId === course.id ? (
                  <>
                    <button
                      type="button"
                      disabled={pendingCourseEditId === course.id}
                      onClick={() => saveCourseEdit(course.id)}
                      className="rounded-full border border-[var(--foreground)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {pendingCourseEditId === course.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditCourse}
                      className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : isFounder(role) ? (
                  <button
                    type="button"
                    onClick={() => startEditCourse(course)}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  >
                    Edit
                  </button>
                ) : null}
                {isFounder(role) ? (
                  <button
                    type="button"
                    disabled={pendingDeleteId === course.id}
                    onClick={() => deleteCourse(course)}
                    className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pendingDeleteId === course.id ? (isTrashMode ? "Deleting..." : "Moving...") : (isTrashMode ? "Delete Permanently" : "Delete")}
                  </button>
                ) : null}
              </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                {course.is_completed ? "Course summary" : "Classes"}
              </p>
              {course.is_completed ? (
                <p className="text-xs text-[var(--muted)]">
                  Completed course: {formatCompletedDate(course.completed_start_date)} to{" "}
                  {formatCompletedDate(course.completed_end_date)} ·{" "}
                  {course.completed_class_count ?? 0} classes
                </p>
              ) : course.course_classes?.length ? (
                <ul className="space-y-2 text-xs text-[var(--muted)]">
                  {sortClassesByStart(course.course_classes).map((courseClass) => (
                    <li key={courseClass.id} className="space-y-2">
                      {editingClassId === courseClass.id ? (
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                          <div className="space-y-2">
                            <input
                              type="datetime-local"
                              value={editStartsAt}
                              onChange={(event) =>
                                setEditStartsAt(event.target.value)
                              }
                              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                            />
                            {isFounder(role) && (
                              <div className="flex items-center gap-2">
                                <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)] whitespace-nowrap">
                                  Duration (min)
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={editDurationMinutes}
                                  onChange={(event) => setEditDurationMinutes(event.target.value)}
                                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                                />
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 items-start">
                            <button
                              type="button"
                              disabled={pendingClassId === courseClass.id}
                              onClick={saveClassEdit}
                              className="rounded-full border border-[var(--foreground)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {pendingClassId === courseClass.id
                                ? "Saving..."
                                : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditClass}
                              className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {(() => {
                            const sorted = sortClassesByStart(
                              course.course_classes
                            );
                            const index = sorted.findIndex(
                              (c) => c.id === courseClass.id
                            );
                            return (
                              <span>
                                Class {index + 1} ·{" "}
                                {new Date(courseClass.starts_at).toLocaleDateString()} ·{" "}
                                {new Date(courseClass.starts_at).toLocaleTimeString(
                                  [],
                                  {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  }
                                )}{" "}
                                -{" "}
                                  {new Date(
                                    new Date(courseClass.starts_at).getTime() +
                                    (courseClass.duration_hours || 1) * 60 * 60 * 1000
                                  ).toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                  {courseClass.duration_hours !== 1 ? ` (${Math.round(courseClass.duration_hours * 60)} min)` : ""}
                                </span>
                            );
                          })()}
                          {isFounder(role) && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEditClass(courseClass)}
                                className="rounded-full border border-[var(--border)] px-3 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={pendingClassDeleteId === courseClass.id}
                                onClick={() => deleteClass(course.id, courseClass)}
                                className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                {pendingClassDeleteId === courseClass.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">No classes yet.</p>
              )}
            </div>

            {course.is_completed || isTrashMode || !isFounder(role) ? null : (
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-start"
                onSubmit={(event) => onCreateClass(course.id, event)}
              >
                <div className="flex-1 space-y-2">
                  <input
                    type="datetime-local"
                    value={
                      classStartsAt[course.id] || getSuggestedStartValue(course) || ""
                    }
                    onChange={(event) =>
                      setClassStartsAt((current) => ({
                        ...current,
                        [course.id]: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                    required
                  />
                  {isFounder(role) && (
                    <div className="flex items-center gap-2">
                      <label className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--muted)] whitespace-nowrap">
                        Duration (min)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={classDurationMinutes[course.id] ?? "60"}
                        onChange={(event) =>
                          setClassDurationMinutes((current) => ({
                            ...current,
                            [course.id]: event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
                      />
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={pendingCourseId === course.id}
                  className="rounded-full border border-[var(--foreground)] px-4 py-3 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap"
                >
                  {pendingCourseId === course.id ? "Adding..." : "Add class"}
                </button>
              </form>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Enrolled students
                </p>
                {isFounder(role) && !isTrashMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEnrollCourseId(course.id);
                      setIsManualEnrollOpen(true);
                      setEnrollUserId("");
                      setEnrollSearch("");
                    }}
                    className="rounded-full border border-[var(--foreground)] px-2 py-1 text-[0.6rem] font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)]"
                  >
                    Add Student
                  </button>
                ) : null}
              </div>
              {course.course_enrollments?.length ? (
                <ul className="space-y-1 text-xs text-[var(--muted)]">
                  {course.course_enrollments.map((student, index) => (
                    <li
                      key={
                        student.id ||
                        student.student_email ||
                        `${student.student_name ?? "student"}-${index}`
                      }
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {student.student_name || "Student"} ·{" "}
                        {student.student_email || "No email"}
                        {student.student_grade ? (
                          <> · Grade {student.student_grade}</>
                        ) : null}
                        {student.student_school ? (
                          <> · {student.student_school}</>
                        ) : null}
                      </span>
                      {isFounder(role) && !isTrashMode ? (
                        <button
                          type="button"
                          disabled={pendingEnrollmentDeleteId === student.id}
                          onClick={() =>
                            removeEnrolledStudent(course.id, student)
                          }
                          className="rounded-full border border-red-200 px-3 py-1 text-[0.6rem] font-semibold text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {pendingEnrollmentDeleteId === student.id
                            ? "Removing..."
                            : "Remove"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted)]">
                  No enrolled students yet.
                </p>
              )}
            </div>
          </div>
        )})}
      </div>

      {isManualEnrollOpen ? (
        <div 
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4" 
          onClick={() => setIsManualEnrollOpen(false)}
        >
          <div 
            className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                Admin
              </p>
              <h3 className="text-lg font-semibold text-[var(--foreground)]">
                Manual Enrollment
              </h3>
              <p className="text-sm text-[var(--muted)]">
                Select a student to enroll in &quot;{courses.find(c => c.id === enrollCourseId)?.title}&quot;.
              </p>
            </div>

            <div className="space-y-3">
              <input 
                type="text"
                placeholder="Search students..."
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--foreground)]"
              />

              <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]">
                {allStudents
                  .filter(s => 
                    s.fullName.toLowerCase().includes(enrollSearch.toLowerCase()) || 
                    s.email.toLowerCase().includes(enrollSearch.toLowerCase())
                  )
                  .map(student => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => setEnrollUserId(student.id)}
                      className={`w-full px-4 py-2 text-left text-xs transition hover:bg-[var(--border)] ${
                        enrollUserId === student.id ? "bg-[var(--border)] font-semibold" : ""
                      }`}
                    >
                      {student.fullName || "Unknown"} ({student.email})
                    </button>
                  ))}
                {allStudents.length === 0 && (
                  <p className="p-4 text-center text-xs text-[var(--muted)]">No students found.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsManualEnrollOpen(false)}
                disabled={isEnrolling}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isEnrolling || !enrollUserId}
                onClick={onManualEnroll}
                className={`rounded-full border border-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-70`}
              >
                {isEnrolling ? "Enrolling..." : "Enroll Student"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
