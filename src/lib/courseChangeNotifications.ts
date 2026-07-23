import { SupabaseClient } from "@supabase/supabase-js";
import { sendDiscordMessageByChannelName, sendEmail } from "./notificationsServer";
import { formatDiscordTimestamp } from "./discordTimestamp";

// A change line can carry a Discord-specific variant so times render as
// dynamic timestamps in Discord while emails keep static Toronto-time text.
export type CourseChangeItem = {
  text: string;
  discordText?: string;
};

type CourseChangeRecipient = {
  id: string;
  email: string | null;
  full_name: string | null;
  discord_user_id: string | null;
};

type CourseNotificationRow = {
  id: string;
  title: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  co_tutor_id: string | null;
  co_tutor_name: string | null;
  co_tutor_email: string | null;
};

export const formatCourseChangeDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    timeZone: "America/Toronto",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// Discord counterpart of formatCourseChangeDateTime: dynamic timestamp markup
// that renders in each viewer's local timezone.
export const formatCourseChangeDiscordDateTime = (
  value: string | null | undefined
) => {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDiscordTimestamp(date);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getCourseRecipients = async (
  adminClient: SupabaseClient,
  course: CourseNotificationRow
): Promise<CourseChangeRecipient[]> => {
  const tutorIds = [course.created_by, course.co_tutor_id].filter(
    (id): id is string => Boolean(id)
  );

  const { data: users } = tutorIds.length
    ? await adminClient
      .from("app_users")
      .select("id, email, full_name, discord_user_id")
      .in("id", tutorIds)
    : { data: [] };

  const userById = new Map(
    (users ?? []).map((user) => [user.id, user as CourseChangeRecipient])
  );

  const recipients: CourseChangeRecipient[] = [];
  const addRecipient = (
    userId: string | null,
    fallbackName: string | null,
    fallbackEmail: string | null
  ) => {
    const user = userId ? userById.get(userId) : null;
    const recipient: CourseChangeRecipient = {
      id: user?.id ?? userId ?? fallbackEmail ?? fallbackName ?? "unknown",
      email: user?.email ?? fallbackEmail ?? null,
      full_name: user?.full_name ?? fallbackName ?? null,
      discord_user_id: user?.discord_user_id ?? null,
    };

    if (!recipient.email && !recipient.discord_user_id) {
      return;
    }
    if (recipients.some((item) => item.id === recipient.id)) {
      return;
    }
    recipients.push(recipient);
  };

  addRecipient(course.created_by, course.created_by_name, course.created_by_email);
  addRecipient(course.co_tutor_id, course.co_tutor_name, course.co_tutor_email);

  return recipients;
};

export const notifyCourseTutorsOfNewEnrollment = async (
  adminClient: SupabaseClient,
  courseId: string,
  studentName: string,
  studentEmail: string | null
) => {
  try {
    const { data: course, error } = await adminClient
      .from("courses")
      .select("id, title, created_by, created_by_name, created_by_email, co_tutor_id, co_tutor_name, co_tutor_email")
      .eq("id", courseId)
      .single();

    if (error || !course) {
      console.error("Failed to load course for enrollment notification:", error);
      return;
    }

    const recipients = await getCourseRecipients(
      adminClient,
      course as CourseNotificationRow
    );
    if (recipients.length === 0) {
      return;
    }

    const { count: enrolledCount } = await adminClient
      .from("course_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId);

    const courseTitle = String(course.title ?? "your course");
    const discordMentions = recipients
      .map((recipient) =>
        recipient.discord_user_id
          ? `<@${recipient.discord_user_id}>`
          : `**${recipient.full_name || recipient.email || "Tutor"}**`
      )
      .join(" ");

    const studentLabel = studentEmail
      ? `**${studentName || studentEmail}** (${studentEmail})`
      : `**${studentName || "A new student"}**`;
    const countSuffix =
      typeof enrolledCount === "number"
        ? ` The course now has ${enrolledCount} enrolled student${enrolledCount === 1 ? "" : "s"}.`
        : "";

    await sendDiscordMessageByChannelName(
      "executives",
      `${discordMentions} New enrollment: ${studentLabel} just enrolled in your course **${courseTitle}**.${countSuffix}`
    );
  } catch (error) {
    console.error("Failed to notify course tutors of new enrollment:", error);
  }
};

export const notifyCourseTutorsOfChanges = async (
  adminClient: SupabaseClient,
  courseId: string,
  changes: (string | CourseChangeItem)[],
  changedBy: string
) => {
  const cleanChanges = changes
    .map((item) =>
      typeof item === "string"
        ? { text: item.trim(), discordText: item.trim() }
        : {
          text: item.text.trim(),
          discordText: (item.discordText ?? item.text).trim(),
        }
    )
    .filter((item) => Boolean(item.text));
  if (cleanChanges.length === 0) {
    return;
  }

  try {
    const { data: course, error } = await adminClient
      .from("courses")
      .select("id, title, created_by, created_by_name, created_by_email, co_tutor_id, co_tutor_name, co_tutor_email")
      .eq("id", courseId)
      .single();

    if (error || !course) {
      console.error("Failed to load course for change notification:", error);
      return;
    }

    const recipients = await getCourseRecipients(
      adminClient,
      course as CourseNotificationRow
    );
    if (recipients.length === 0) {
      return;
    }

    const courseTitle = String(course.title ?? "your course");
    const discordMentions = recipients
      .map((recipient) =>
        recipient.discord_user_id
          ? `<@${recipient.discord_user_id}>`
          : `**${recipient.full_name || recipient.email || "Tutor"}**`
      )
      .join(" ");
    const discordChangeList = cleanChanges
      .map((item) => `- ${item.discordText}`)
      .join("\n");

    await sendDiscordMessageByChannelName(
      "executives",
      `${discordMentions} A course you tutor, **${courseTitle}**, was updated by ${changedBy}.\n\n**Changes:**\n${discordChangeList}`
    );

    const htmlChangeList = cleanChanges
      .map((item) => `<li>${escapeHtml(item.text)}</li>`)
      .join("");
    const emailHtml = `
      <p>A course you tutor, <strong>${escapeHtml(courseTitle)}</strong>, was updated by ${escapeHtml(changedBy)}.</p>
      <p><strong>Changes:</strong></p>
      <ul>${htmlChangeList}</ul>
      <p>Please check YanLearn for the latest course details.</p>
    `;

    for (const recipient of recipients) {
      if (!recipient.email) {
        continue;
      }
      await sendEmail(
        recipient.email,
        `Course Updated: ${courseTitle}`,
        emailHtml
      );
    }
  } catch (error) {
    console.error("Failed to notify course tutors of changes:", error);
  }
};
