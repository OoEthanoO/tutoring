/**
 * Course needs: the running list of courses nobody teaches yet. The founder
 * trio adds to it, YanBot passes each new one on to the tutors in Discord, and
 * every executive can see what is still open in Course requests.
 *
 * The parsing, the identity of a need, and the message wording live here, away
 * from the route, so they can be tested — the message is the whole feature and
 * the key decides whether a course gets announced twice.
 */

/** More than this and it is a spreadsheet, not an announcement. */
export const maxCourseNeeds = 20;
/** Long enough for "Grade 11 Chemistry (SCH3U) — evenings", short enough to be a course. */
export const maxCourseNeedLength = 120;

/**
 * What makes two typed courses the same course. Case and spacing only, so
 * "Grade 6 French" and "grade 6  french" are one entry on the list and get one
 * announcement — but "Grade 6 French" and "Grade 7 French" stay separate.
 */
export const courseNeedKey = (need: string): string =>
  String(need ?? "").trim().toLowerCase().replace(/\s+/g, " ");

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
    const key = courseNeedKey(need);
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
    `in your dashboard: ${siteUrl}\n` +
    "Every course we still need is listed there.";

  if (needs.length === 1) {
    return (
      `${lead}We need a tutor to teach **${escapeDiscordMarkdown(needs[0])}**.\n\n` +
      ask.replace("one of these", "it")
    );
  }

  const list = needs.map((need) => `• **${escapeDiscordMarkdown(need)}**`).join("\n");
  return `${lead}We need tutors to teach:\n${list}\n\n${ask}`;
};

/**
 * What to tell the founder after they hit send. Worth its own function because
 * the interesting cases are the quiet ones — a course already on the list is
 * deliberately not announced again, and saying nothing would look like the
 * send failed.
 */
export const summariseCourseNeedsSend = ({
  added,
  alreadyListed,
  channel = "everyone",
}: {
  /** Needs that are new, and so were announced. */
  added: string[];
  /** Needs that were already on the list, and so were not. */
  alreadyListed: string[];
  channel?: string;
}): string => {
  const sentences: string[] = [];

  if (added.length === 1) {
    sentences.push(`YanBot asked for a tutor for “${added[0]}” in #${channel}.`);
  } else if (added.length > 1) {
    sentences.push(`YanBot asked for tutors for ${added.length} courses in #${channel}.`);
  }

  if (alreadyListed.length === 1) {
    sentences.push(`“${alreadyListed[0]}” was already on the list, so it was not announced again.`);
  } else if (alreadyListed.length > 1) {
    sentences.push(
      `${alreadyListed.length} courses were already on the list, so they were not announced again.`
    );
  }

  return sentences.join(" ");
};
