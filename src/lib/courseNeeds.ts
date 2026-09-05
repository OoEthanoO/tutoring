/**
 * Course needs: the founder trio saying "we need someone to teach this", and
 * YanBot passing that on to the tutors in Discord.
 *
 * The parsing and message wording live here, away from the route, so they can
 * be tested — the message is the whole feature.
 */

/** More than this and it is a spreadsheet, not an announcement. */
export const maxCourseNeeds = 20;
/** Long enough for "Grade 11 Chemistry (SCH3U) — evenings", short enough to be a course. */
export const maxCourseNeedLength = 120;

/**
 * Split what the founder typed into individual needs: one per line, blank lines
 * and duplicates dropped. Comparison for duplicates ignores case and spacing so
 * "Grade 6 French" and "grade 6  french" do not both go out.
 */
export const parseCourseNeeds = (input: string): string[] => {
  const seen = new Set<string>();
  const needs: string[] = [];
  for (const line of String(input ?? "").split(/\r?\n/)) {
    // Tolerate list markers, since people paste lists.
    const need = line.trim().replace(/^[-*•]\s*/, "").trim();
    if (!need) {
      continue;
    }
    const key = need.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    needs.push(need);
  }
  return needs;
};

export type CourseNeedsProblem =
  | { ok: true; needs: string[] }
  | { ok: false; error: string };

export const validateCourseNeeds = (input: string): CourseNeedsProblem => {
  const needs = parseCourseNeeds(input);
  if (needs.length === 0) {
    return { ok: false, error: "Type at least one course, for example “Grade 6 French”." };
  }
  if (needs.length > maxCourseNeeds) {
    return {
      ok: false,
      error: `That is ${needs.length} courses; send at most ${maxCourseNeeds} at a time.`,
    };
  }
  const tooLong = needs.find((need) => need.length > maxCourseNeedLength);
  if (tooLong) {
    return {
      ok: false,
      error: `“${tooLong.slice(0, 40)}…” is too long for a course name (max ${maxCourseNeedLength} characters).`,
    };
  }
  return { ok: true, needs };
};

/**
 * Discord treats these as formatting, so a course name containing one would
 * come out mangled — or, with a stray backtick, break the rest of the message.
 */
export const escapeDiscordMarkdown = (text: string): string =>
  text.replace(/([\\*_`~|>])/g, "\\$1");

export const buildCourseNeedsMessage = ({
  needs,
  mentions = [],
  siteUrl = "https://learn.ethanyanxu.com",
}: {
  needs: string[];
  /** Role mentions to lead with, already formatted as <@&id>. */
  mentions?: string[];
  siteUrl?: string;
}): string => {
  const lead = mentions.length > 0 ? `${mentions.join(" ")} ` : "";
  const ask =
    "If you can teach one of these, send a course request from **Course requests** " +
    `in your dashboard: ${siteUrl}`;

  if (needs.length === 1) {
    return (
      `${lead}We need a tutor to teach **${escapeDiscordMarkdown(needs[0])}**.\n\n` +
      ask.replace("one of these", "it")
    );
  }

  const list = needs.map((need) => `• **${escapeDiscordMarkdown(need)}**`).join("\n");
  return `${lead}We need tutors to teach:\n${list}\n\n${ask}`;
};
