import { founderEmails } from "./roles";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";

type DiscordChannel = {
  id: string;
  type: number;
  name: string;
};

type DiscordRole = {
  id: string;
  name: string;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Sends an email using the Resend API.
 * This is a server-side only utility.
 * Attachments use Resend's shape: base64 `content` + `filename`.
 */
const postResendEmail = async (
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error: string }> => {
  if (!resendApiKey || !resendFrom) {
    console.warn("Skipping email send: Missing configuration.", { subject: payload.subject });
    return { ok: false, error: "Missing email configuration." };
  }

  const maxAttempts = 3;
  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: resendFrom, ...payload }),
      });

      if (response.ok) {
        return { ok: true, error: "" };
      }

      lastError = await response.text().catch(() => "Unknown error");
      console.error(`Failed to send email (Attempt ${attempt}):`, lastError);

      if (response.status !== 429 && response.status < 500) {
        // Non-retriable error
        break;
      }

      if (attempt < maxAttempts) {
        // Honor the provider's retry-after hint when present.
        const retryAfterSeconds = Number.parseFloat(
          response.headers.get("retry-after") ?? ""
        );
        await sleep(
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.ceil(retryAfterSeconds * 1000)
            : 1000 * 2 ** (attempt - 1)
        );
      }
      continue;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";
      console.error(`Error sending email (Attempt ${attempt}):`, error);
    }

    if (attempt < maxAttempts) {
      await sleep(1000 * 2 ** (attempt - 1)); // Exponential backoff
    }
  }

  return { ok: false, error: lastError };
};

export const sendEmail = async (
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: string }[]
): Promise<boolean> => {
  if (!to) {
    console.warn("Skipping email send: Missing recipient.", { subject });
    return false;
  }
  const result = await postResendEmail({
    to,
    subject,
    html,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });
  return result.ok;
};

// Resend allows at most 50 recipients (to + cc + bcc combined) per email.
const RESEND_MAX_RECIPIENTS = 50;

export type BccSendResult = {
  sentCount: number;
  failed: { email: string; reason: string }[];
};

/**
 * Sends ONE email to many recipients via BCC (chunked to respect Resend's
 * per-message recipient limit) instead of one email per recipient. The
 * visible "to" is the sender address, so recipients cannot see each other.
 * Only use this for content that is identical for every recipient.
 */
export const sendBccEmail = async (
  bccEmails: string[],
  subject: string,
  html: string
): Promise<BccSendResult> => {
  const recipients = Array.from(
    new Set(bccEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))
  );
  const result: BccSendResult = { sentCount: 0, failed: [] };
  if (recipients.length === 0) {
    return result;
  }

  // Leave one recipient slot for the "to" address (the sender).
  const chunkSize = RESEND_MAX_RECIPIENTS - 1;
  for (let start = 0; start < recipients.length; start += chunkSize) {
    const chunk = recipients.slice(start, start + chunkSize);
    const outcome = await postResendEmail({
      to: resendFrom,
      bcc: chunk,
      subject,
      html,
    });
    if (outcome.ok) {
      result.sentCount += chunk.length;
    } else {
      for (const email of chunk) {
        result.failed.push({ email, reason: outcome.error });
      }
    }
    // Pace requests to stay under the email provider's rate limit.
    await sleep(150);
  }
  return result;
};

/**
 * Notifies all founder emails with a single BCC'd email instead of one
 * send per founder.
 */
export const notifyFounders = async (subject: string, html: string) => {
  if (!founderEmails || founderEmails.length === 0) {
    return;
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { failed } = await sendBccEmail(founderEmails, subject, html);
    if (failed.length === 0) {
      return;
    }
    // Wait longer on failure before retrying to prevent rate limiting
    await sleep(2000);
  }

  console.error("Failed to notify founders after all retries.");
};

/**
 * Sends a Discord message to a channel by its name. Pass allowedRoleMentionIds to
 * explicitly permit role pings (e.g. <@&roleId> in the content), matching the
 * allowed_mentions pattern used by the class-reminders cron.
 */
export const sendDiscordMessageByChannelName = async (
  channelName: string,
  content: string,
  allowedRoleMentionIds?: string[]
): Promise<boolean> => {
  if (!discordBotToken || !discordGuildId || !channelName || !content) {
    console.warn("Skipping Discord message: Missing configuration, channel name, or content.");
    return false;
  }

  try {
    // 1. List channels to find the ID
    const channelsRes = await fetch(
      `https://discord.com/api/v10/guilds/${discordGuildId}/channels`,
      {
        headers: { Authorization: `Bot ${discordBotToken}` },
      }
    );

    if (!channelsRes.ok) {
      console.error(`Failed to list Discord channels: ${channelsRes.status}`);
      return false;
    }

    const channels = (await channelsRes.json()) as DiscordChannel[];
    const targetChannel = channels.find(
      (ch) => (ch.type === 0 || ch.type === 5) && ch.name === channelName
    );

    if (!targetChannel) {
      console.error(`Discord channel #${channelName} not found. Available channels:`, channels.map(ch => ch.name).join(', '));
      return false;
    }

    // 2. Send the message
    const messageRes = await fetch(
      `https://discord.com/api/v10/channels/${targetChannel.id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${discordBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          ...(allowedRoleMentionIds && allowedRoleMentionIds.length > 0
            ? { allowed_mentions: { parse: [], roles: allowedRoleMentionIds, users: [] } }
            : {}),
        }),
      }
    );

    if (!messageRes.ok) {
      const errorText = await messageRes.text().catch(() => "Unknown error");
      console.error(`Failed to send Discord message to #${channelName}:`, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error sending Discord message to #${channelName}:`, error);
    return false;
  }
};
export const getDiscordRoleIdByName = async (roleName: string): Promise<string | null> => {
  if (!discordBotToken || !discordGuildId) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${discordGuildId}/roles`, {
      headers: { Authorization: `Bot ${discordBotToken}` }
    });
    if (!res.ok) return null;
    const roles = await res.json() as DiscordRole[];
    const role = roles.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    return role ? role.id : null;
  } catch {
    return null;
  }
};
