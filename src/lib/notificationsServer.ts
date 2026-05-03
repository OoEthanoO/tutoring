import { founderEmails } from "./roles";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";
const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Sends an email using the Resend API.
 * This is a server-side only utility.
 */
export const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  if (!resendApiKey || !resendFrom || !to) {
    console.warn("Skipping email send: Missing configuration or recipient.", { to, subject });
    return false;
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to,
          subject,
          html,
        }),
      });

      if (response.ok) {
        return true;
      }

      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`Failed to send email to ${to} (Attempt ${attempt}):`, errorText);

      if (response.status !== 429 && response.status < 500) {
        // Non-retriable error
        break;
      }
    } catch (error) {
      console.error(`Error sending email to ${to} (Attempt ${attempt}):`, error);
    }

    if (attempt < maxAttempts) {
      await sleep(1000 * Math.pow(2, attempt - 1)); // Exponential backoff
    }
  }
  
  return false;
};

/**
 * Notifies all founder emails sequentially.
 * Waits for each email to succeed before moving to the next.
 */
export const notifyFounders = async (subject: string, html: string) => {
  if (!founderEmails || founderEmails.length === 0) {
    return;
  }

  for (const email of founderEmails) {
    let success = false;
    let notifyAttempts = 0;
    
    // Keep retrying until success to guarantee sequential delivery
    // after each subsequent email requests have been made successfully
    while (!success && notifyAttempts < 5) {
      notifyAttempts++;
      success = await sendEmail(email, subject, html);
      
      if (!success) {
        // Wait longer on failure before retrying to prevent rate limiting
        await sleep(2000); 
      }
    }
    
    if (!success) {
      console.error(`Failed to notify founder ${email} after all retries.`);
    }

    // Sequential delay to ensure delivery and avoid throttling (2 req/sec rate limit)
    await sleep(1000);
  }
};

/**
 * Sends a Discord message to a channel by its name.
 */
export const sendDiscordMessageByChannelName = async (channelName: string, content: string): Promise<boolean> => {
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

    const channels = (await channelsRes.json()) as any[];
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
        body: JSON.stringify({ content }),
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
    const roles = await res.json() as any[];
    const role = roles.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    return role ? role.id : null;
  } catch {
    return null;
  }
};
