import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/authServer";
import { isFounder, resolveUserRole } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type CourseClassRow = {
  id: string;
  title: string;
  starts_at: string;
  duration_hours: number | string | null;
};

type EnrolledCourse = {
  id: string;
  title: string;
  deleted_at: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  course_classes: CourseClassRow[] | null;
};

type EnrollmentStudentRow = {
  student_name: string | null;
  student_email: string | null;
};

type UpcomingClass = {
  id: string;
  course_id: string;
  course_title: string;
  class_title: string;
  starts_at: string;
  duration_hours: number;
  role_in_course: "student" | "tutor" | "founder";
  tutor_name: string;
  students?: { name: string | null; email: string | null }[];
};

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const role = resolveUserRole(user.email, user.role ?? null);
  const isFounderUser = isFounder(role);

  const nowMs = Date.now();
  const upcomingClasses: UpcomingClass[] = [];
  const seenClassIds = new Set<string>();

  // Fetch classes where user is enrolled as a student
  const { data: enrolledData, error: enrolledError } = await adminClient
    .from("course_enrollments")
    .select(
      "course:courses(id, title, deleted_at, created_by_name, created_by_email, course_classes(id, title, starts_at, duration_hours))"
    )
    .eq("student_id", user.id);

  if (!enrolledError && enrolledData) {
    for (const item of enrolledData) {
      // Supabase types a to-one embed as an array; it is a single object at runtime.
      const course = item.course as unknown as EnrolledCourse | null;
      if (!course || course.deleted_at) continue;
      const classes = course.course_classes || [];
      for (const cls of classes) {
        const startMs = new Date(cls.starts_at).getTime();
        const durationHours = Number.parseFloat(String(cls.duration_hours || "1"));
        const endMs = startMs + durationHours * 60 * 60 * 1000;
        
        if (endMs > nowMs) {
          upcomingClasses.push({
            id: cls.id,
            course_id: course.id,
            course_title: course.title,
            class_title: cls.title,
            starts_at: cls.starts_at,
            duration_hours: durationHours,
            role_in_course: "student",
            tutor_name: course.created_by_name || course.created_by_email || "Unknown tutor",
          });
          seenClassIds.add(cls.id);
        }
      }
    }
  }

  // Fetch classes where user is the tutor (creator) or if user is founder, all classes
  let query = adminClient
    .from("courses")
    .select(
      "id, title, created_by, created_by_name, created_by_email, deleted_at, course_classes(id, title, starts_at, duration_hours), course_enrollments(student_name, student_email)"
    )
    .is("deleted_at", null);

  if (!isFounderUser) {
    query = query.eq("created_by", user.id);
  }

  const { data: taughtData, error: taughtError } = await query;

  if (!taughtError && taughtData) {
    for (const course of taughtData) {
      const isUsuallyTutor = course.created_by === user.id;
      const classes = course.course_classes || [];
      const enrollments = course.course_enrollments || [];
      const students = enrollments.map((e: EnrollmentStudentRow) => ({
        name: e.student_name,
        email: e.student_email,
      }));

      for (const cls of classes) {
        const startMs = new Date(cls.starts_at).getTime();
        const durationHours = Number.parseFloat(String(cls.duration_hours || "1"));
        const endMs = startMs + durationHours * 60 * 60 * 1000;
        
        if (endMs > nowMs && !seenClassIds.has(cls.id)) {
          upcomingClasses.push({
            id: cls.id,
            course_id: course.id,
            course_title: course.title,
            class_title: cls.title,
            starts_at: cls.starts_at,
            duration_hours: durationHours,
            role_in_course: isUsuallyTutor ? "tutor" : "founder",
            tutor_name: course.created_by_name || course.created_by_email || "Unknown tutor",
            students,
          });
          seenClassIds.add(cls.id);
        }
      }
    }
  }

  // Sort chronologically ascending
  upcomingClasses.sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  );

  return NextResponse.json({ classes: upcomingClasses });
}
