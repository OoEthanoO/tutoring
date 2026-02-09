import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const isFiveMinuteSharp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return (
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0 &&
    parsed.getUTCMinutes() % 5 === 0
  );
};

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        title?: string;
        description?: string;
        isCompleted?: boolean;
        completedStartDate?: string;
        completedEndDate?: string;
        completedClassCount?: number;
        classes?: { title?: string; startsAt?: string; durationHours?: number }[];
      }
    | null;

  const title = body?.title?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const isCompleted = body?.isCompleted === true;
  const completedStartDate = body?.completedStartDate?.trim() ?? "";
  const completedEndDate = body?.completedEndDate?.trim() ?? "";
  const completedClassCount =
    typeof body?.completedClassCount === "number"
      ? Math.floor(body.completedClassCount)
      : 0;
  const classes = Array.isArray(body?.classes) ? body?.classes ?? [] : [];
  const creatorName =
    String(user.full_name ?? "").trim() || user.email || "Unknown tutor";

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (isCompleted && role !== "founder") {
    return NextResponse.json(
      { error: "Only the founder can create completed courses." },
      { status: 403 }
    );
  }

  if (isCompleted) {
    if (!completedStartDate || !completedEndDate || completedClassCount <= 0) {
      return NextResponse.json(
        {
          error:
            "Completed courses require start date, end date, and number of classes.",
        },
        { status: 400 }
      );
    }

    const startDate = new Date(completedStartDate);
    const endDate = new Date(completedEndDate);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      endDate.getTime() < startDate.getTime()
    ) {
      return NextResponse.json(
        { error: "Completed course dates are invalid." },
        { status: 400 }
      );
    }
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error: insertError } = await adminClient
    .from("courses")
    .insert({
      title,
      description,
      is_completed: isCompleted,
      completed_start_date: isCompleted ? completedStartDate : null,
      completed_end_date: isCompleted ? completedEndDate : null,
      completed_class_count: isCompleted ? completedClassCount : null,
      created_by: user.id,
      created_by_name: creatorName,
      created_by_email: user.email ?? null,
    })
    .select(
      "id, title, short_name, description, is_completed, completed_start_date, completed_end_date, completed_class_count, created_by, created_by_name, created_by_email, created_at"
    )
    .single();

  if (insertError || !data) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create course." },
      { status: 500 }
    );
  }

  let createdClasses:
    | { id: string; title: string; starts_at: string; created_at: string }[]
    | null = null;

  const classRows = classes
    .map((item) => ({
      title: item?.title?.trim() ?? "",
      startsAt: item?.startsAt?.trim() ?? "",
      durationHours: 1,
    }))
    .filter((item) => item.title && item.startsAt);

  if (!isCompleted) {
    const invalidClassStart = classRows.find(
      (item) => !isFiveMinuteSharp(item.startsAt)
    );
    if (invalidClassStart) {
      return NextResponse.json(
        {
          error:
            "Class start times must be on a 5-minute mark (for example 12:00, 12:05, 12:10).",
        },
        { status: 400 }
      );
    }
  }

  if (!isCompleted && classRows.length > 0) {
    const { data: classData, error: classError } = await adminClient
      .from("course_classes")
      .insert(
        classRows.map((item) => ({
          course_id: data.id,
          title: item.title,
          starts_at: item.startsAt,
          duration_hours: item.durationHours,
          created_by: user.id,
        }))
      )
      .select("id, title, starts_at, duration_hours, created_at");

    if (classError || !classData) {
      return NextResponse.json(
        { error: classError?.message ?? "Failed to add classes." },
        { status: 500 }
      );
    }

    createdClasses = classData;
  }

  return NextResponse.json({
    course: {
      ...data,
      course_classes: createdClasses ?? [],
    },
  });
}

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const query = adminClient
    .from("courses")
    .select(
      "id, title, short_name, description, is_completed, completed_start_date, completed_end_date, completed_class_count, created_by, created_by_name, created_by_email, created_at, course_classes(id, title, starts_at, duration_hours, created_at)"
    )
    .order("created_at", { ascending: false })
    .order("starts_at", { foreignTable: "course_classes", ascending: true });

  const { data, error: listError } = await query;

  if (listError || !data) {
    return NextResponse.json(
      { error: listError?.message ?? "Failed to load courses." },
      { status: 500 }
    );
  }

  const { data: requestData } = user
    ? await adminClient
        .from("course_enrollment_requests")
        .select("id, course_id, status")
        .eq("student_id", user.id)
    : { data: [] };

  const { data: enrollmentData } = user
    ? await adminClient
        .from("course_enrollments")
        .select("course_id")
        .eq("student_id", user.id)
    : { data: [] };

  const requestByCourse = new Map<string, { id: string; status: string }>();
  (requestData ?? []).forEach((request) => {
    requestByCourse.set(request.course_id, {
      id: request.id,
      status: request.status,
    });
  });

  const enrolledSet = new Set(
    (enrollmentData ?? []).map((item) => item.course_id)
  );

  const creatorIds = Array.from(
    new Set(data.map((course) => course.created_by).filter(Boolean))
  ) as string[];

  const { data: donationData } = creatorIds.length
    ? await adminClient
        .from("tutor_profiles")
        .select("user_id, donation_link")
        .in("user_id", creatorIds)
    : { data: [] };

  const donationMap = new Map(
    (donationData ?? []).map((row) => [row.user_id, row.donation_link ?? null])
  );

  const courses = data.map((course) => {
    const request = requestByCourse.get(course.id);
    const enrolled = enrolledSet.has(course.id);
    const enrollmentStatus = enrolled
      ? "enrolled"
      : request?.status ?? null;

    return {
      ...course,
      donation_link: donationMap.get(course.created_by ?? "") ?? null,
      enrollment_status: enrollmentStatus,
      enrollment_request_id: request?.id ?? null,
    };
  });

  return NextResponse.json({ courses });
}

export async function DELETE(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (role !== "founder") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { courseId?: string }
    | null;

  if (!body?.courseId) {
    return NextResponse.json({ error: "Missing course id." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error: deleteError } = await adminClient
    .from("courses")
    .delete()
    .eq("id", body.courseId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message ?? "Failed to delete course." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment configuration." },
      { status: 500 }
    );
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!canManageCourses(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        courseId?: string;
        title?: string;
        shortName?: string | null;
        description?: string | null;
        createdBy?: string;
      }
    | null;

  if (!body?.courseId) {
    return NextResponse.json({ error: "Missing course id." }, { status: 400 });
  }

  const title =
    typeof body.title === "string" ? body.title.trim() : undefined;
  const description =
    typeof body.description === "string" ? body.description.trim() : undefined;
  const shortName =
    body.shortName === null
      ? null
      : typeof body.shortName === "string"
        ? body.shortName.trim()
        : undefined;
  const createdBy =
    typeof body.createdBy === "string" && body.createdBy.trim()
      ? body.createdBy.trim()
      : undefined;

  if (title !== undefined && !title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (
    title === undefined &&
    description === undefined &&
    shortName === undefined &&
    createdBy === undefined
  ) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const updatePayload: {
    title?: string;
    short_name?: string | null;
    description?: string | null;
    created_by?: string;
    created_by_name?: string | null;
    created_by_email?: string | null;
  } = {};
  if (title !== undefined) {
    updatePayload.title = title;
  }
  if (description !== undefined) {
    updatePayload.description = description ? description : null;
  }
  if (shortName !== undefined) {
    if (role !== "founder") {
      return NextResponse.json(
        { error: "Only the founder can set short name." },
        { status: 403 }
      );
    }
    updatePayload.short_name = shortName || null;
  }

  if (createdBy !== undefined) {
    if (role !== "founder") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: tutorUser, error: tutorError } = await adminClient
      .from("app_users")
      .select("id, email, full_name, role")
      .eq("id", createdBy)
      .maybeSingle();

    if (tutorError || !tutorUser) {
      return NextResponse.json(
        { error: "Unable to find selected tutor." },
        { status: 400 }
      );
    }

    if (resolveUserRole(tutorUser.email, tutorUser.role ?? null) === "student") {
      return NextResponse.json(
        { error: "Selected user is not a tutor." },
        { status: 400 }
      );
    }

    updatePayload.created_by = tutorUser.id;
    updatePayload.created_by_name =
      String(tutorUser.full_name ?? "").trim() || tutorUser.email || null;
    updatePayload.created_by_email = tutorUser.email ?? null;
  }

  let updateQuery = adminClient
    .from("courses")
    .update(updatePayload)
    .eq("id", body.courseId);

  if (role === "tutor" && createdBy === undefined) {
    updateQuery = updateQuery.eq("created_by", user.id);
  }

  const { data, error: updateError } = await updateQuery
    .select(
      "id, title, short_name, description, is_completed, completed_start_date, completed_end_date, completed_class_count, created_by, created_by_name, created_by_email, created_at"
    )
    .single();

  if (updateError || !data) {
    return NextResponse.json(
      {
        error:
          updateError?.message ??
          "Unable to update course. Ensure you own this course.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ course: data });
}
