import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageCourses, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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
        classes?: { title?: string; startsAt?: string; durationHours?: number }[];
      }
    | null;

  const title = body?.title?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const classes = Array.isArray(body?.classes) ? body?.classes ?? [] : [];
  const creatorName =
    String(user.full_name ?? "").trim() || user.email || "Unknown tutor";

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error: insertError } = await adminClient
    .from("courses")
    .insert({
      title,
      description,
      created_by: user.id,
      created_by_name: creatorName,
      created_by_email: user.email ?? null,
    })
    .select(
      "id, title, description, created_by, created_by_name, created_by_email, created_at"
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
      durationHours:
        typeof item?.durationHours === "number" && item.durationHours > 0
          ? item.durationHours
          : 1,
    }))
    .filter((item) => item.title && item.startsAt);

  if (classRows.length > 0) {
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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let query = adminClient
    .from("courses")
    .select(
      "id, title, description, created_by, created_by_name, created_by_email, created_at, course_classes(id, title, starts_at, duration_hours, created_at)"
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

  const { data: requestData } = await adminClient
    .from("course_enrollment_requests")
    .select("id, course_id, status")
    .eq("student_id", user.id);

  const { data: enrollmentData } = await adminClient
    .from("course_enrollments")
    .select("course_id")
    .eq("student_id", user.id);

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
  const createdBy =
    typeof body.createdBy === "string" && body.createdBy.trim()
      ? body.createdBy.trim()
      : undefined;

  if (title !== undefined && !title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (title === undefined && description === undefined && createdBy === undefined) {
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
    .eq("id", body.courseId)
    .select(
      "id, title, description, created_by, created_by_name, created_by_email, created_at"
    )
    .single();

  if (role === "tutor" && createdBy === undefined) {
    updateQuery = updateQuery.eq("created_by", user.id);
  }

  const { data, error: updateError } = await updateQuery;

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
