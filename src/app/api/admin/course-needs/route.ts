import { NextResponse, type NextRequest } from "next/server";
import { isFounder, resolveUserRole } from "@/lib/roles";
import { getRequestUser } from "@/lib/authServer";
import { buildCourseNeedsMessage, validateCourseNeeds } from "@/lib/courseNeeds";
import { getDiscordRoleIdByName, sendDiscordMessageByChannelName } from "@/lib/notificationsServer";

/**
 * "We need someone to teach Grade 6 French." The founder trio types the
 * courses; YanBot announces them to the tutors and points them at Course
 * requests.
 */

/** Everyone is in this channel, so a call for tutors reaches all of them. */
const channelName = String(process.env.DISCORD_EVERYONE_CHANNEL_NAME ?? "").trim() || "everyone";

/** The Discord roles held by people who can take a course on. */
const tutorRoleNames = ["Chief Executive", "Executive", "Junior Executive"];

const siteUrl =
  String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "") ||
  "https://learn.ethanyanxu.com";

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

  // Best effort: an unresolvable role just means the message goes out without
  // that mention, which is better than not going out at all.
  const roleIds = await Promise.all(
    tutorRoleNames.map((name) =>
      getDiscordRoleIdByName(name).catch(() => null)
    )
  );
  const mentions = roleIds.filter((id): id is string => Boolean(id)).map((id) => `<@&${id}>`);

  const content = buildCourseNeedsMessage({ needs: validated.needs, mentions, siteUrl });
  const sent = await sendDiscordMessageByChannelName(
    channelName,
    content,
    // Only these roles may be pinged, whatever the course names contain.
    roleIds.filter((id): id is string => Boolean(id))
  );

  if (!sent) {
    return NextResponse.json(
      { error: `Could not post to #${channelName}. Check the bot token and that the channel exists.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, needs: validated.needs, channel: channelName });
}
