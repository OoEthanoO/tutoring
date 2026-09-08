import { NextResponse, type NextRequest } from "next/server";
import { isExecutive, isFounder, resolveUserRole } from "@/lib/roles";
import { getAdminClient, getRequestUser } from "@/lib/authServer";
import {
  buildCourseNeedsMessage,
  courseNeedKey,
  validateCourseNeeds,
} from "@/lib/courseNeeds";
import { getDiscordRoleIdByName, sendDiscordMessageByChannelName } from "@/lib/notificationsServer";

/**
 * The running list of courses nobody teaches yet.
 *
 * The founder trio adds and removes; every executive can read it, since they
 * are the people who would take one of these on. Adding is what announces:
 * YanBot posts the new courses to Discord, and a course already on the list is
 * deliberately not announced a second time.
 */

/** Everyone is in this channel, so a call for tutors reaches all of them. */
const channelName = String(process.env.DISCORD_EVERYONE_CHANNEL_NAME ?? "").trim() || "everyone";

/** The Discord roles held by people who can take a course on. */
const tutorRoleNames = ["Chief Executive", "Executive", "Junior Executive"];

const siteUrl =
  String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "") ||
  "https://learn.ethanyanxu.com";

type CourseNeedRow = {
  id: string;
  need: string;
  created_at: string;
  announced_at: string | null;
  created_by: string | null;
  created_by_email: string | null;
};

/** Post the given needs to Discord. Returns false when nothing was sent. */
const announceNeeds = async (needs: string[]): Promise<boolean> => {
  if (needs.length === 0) {
    return true;
  }

  // Best effort: an unresolvable role just means the message goes out without
  // that mention, which is better than not going out at all.
  const roleIds = (
    await Promise.all(tutorRoleNames.map((name) => getDiscordRoleIdByName(name).catch(() => null)))
  ).filter((id): id is string => Boolean(id));

  const content = buildCourseNeedsMessage({
    needs,
    mentions: roleIds.map((id) => `<@&${id}>`),
    siteUrl,
  });

  return sendDiscordMessageByChannelName(
    channelName,
    content,
    // Only these roles may be pinged, whatever the course names contain.
    roleIds
  );
};

/** The list, newest first, with the name of whoever added each course. */
const listNeeds = async () => {
  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("course_needs")
    .select("id, need, created_at, announced_at, created_by, created_by_email")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CourseNeedRow[];
  const authorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const nameById = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data: authors } = await adminClient
      .from("app_users")
      .select("id, full_name")
      .in("id", authorIds);
    for (const author of authors ?? []) {
      const name = String(author.full_name ?? "").trim();
      if (name) {
        nameById.set(String(author.id), name);
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    need: row.need,
    created_at: row.created_at,
    announced_at: row.announced_at,
    added_by: nameById.get(String(row.created_by ?? "")) ?? row.created_by_email ?? null,
  }));
};

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!isExecutive(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    return NextResponse.json({ needs: await listNeeds(), channel: channelName });
  } catch {
    return NextResponse.json({ error: "Could not load the course needs." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!isFounder(role)) {
    return NextResponse.json(
      { error: "Only the founder, CEO, and COO can send course needs." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as { needs?: string } | null;
  const validated = validateCourseNeeds(body?.needs ?? "");
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const adminClient = getAdminClient();

  // `ignore_duplicates` against the unique key is what decides "new": the
  // insert returns only the rows it actually created, so two people adding the
  // same course at the same moment still produces one entry and one ping.
  const { data: inserted, error } = await adminClient
    .from("course_needs")
    .upsert(
      validated.needs.map((need) => ({
        need,
        need_key: courseNeedKey(need),
        created_by: user.id,
        created_by_email: user.email,
      })),
      { onConflict: "need_key", ignoreDuplicates: true }
    )
    .select("id, need");

  if (error) {
    return NextResponse.json(
      { error: `Could not save the course needs: ${error.message}` },
      { status: 500 }
    );
  }

  const added = (inserted ?? []) as { id: string; need: string }[];
  const addedKeys = new Set(added.map((row) => courseNeedKey(row.need)));
  const alreadyListed = validated.needs.filter((need) => !addedKeys.has(courseNeedKey(need)));

  const sent = await announceNeeds(added.map((row) => row.need));

  if (sent && added.length > 0) {
    await adminClient
      .from("course_needs")
      .update({ announced_at: new Date().toISOString() })
      .in(
        "id",
        added.map((row) => row.id)
      );
  }

  const needs = await listNeeds().catch(() => null);

  if (!sent) {
    // The courses are on the list either way — say so, so this does not read as
    // "nothing happened", and leave announced_at null for the retry.
    return NextResponse.json(
      {
        error:
          `Added to the list, but YanBot could not post to #${channelName}. ` +
          "Check the bot token and that the channel exists, then use Announce again.",
        needs,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    added: added.map((row) => row.need),
    alreadyListed,
    channel: channelName,
    needs,
  });
}

/** Announce the needs that are on the list but never made it to Discord. */
export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!isFounder(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("course_needs")
    .select("id, need")
    .is("announced_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Could not load the course needs." }, { status: 500 });
  }

  const pending = (data ?? []) as { id: string; need: string }[];
  if (pending.length === 0) {
    return NextResponse.json({ success: true, announced: [], needs: await listNeeds() });
  }

  const sent = await announceNeeds(pending.map((row) => row.need));
  if (!sent) {
    return NextResponse.json(
      { error: `YanBot still could not post to #${channelName}.` },
      { status: 502 }
    );
  }

  await adminClient
    .from("course_needs")
    .update({ announced_at: new Date().toISOString() })
    .in(
      "id",
      pending.map((row) => row.id)
    );

  return NextResponse.json({
    success: true,
    announced: pending.map((row) => row.need),
    channel: channelName,
    needs: await listNeeds(),
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const role = resolveUserRole(user.email, user.role ?? null);
  if (!isFounder(role)) {
    return NextResponse.json(
      { error: "Only the founder, CEO, and COO can remove course needs." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  const id = String(body?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Which course need should be removed?" }, { status: 400 });
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("course_needs")
    .delete()
    .eq("id", id)
    .select("need")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not remove the course need." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    // Null when it was already gone — the panel treats that as done, not an error.
    removed: data?.need ?? null,
    needs: await listNeeds().catch(() => null),
  });
}
