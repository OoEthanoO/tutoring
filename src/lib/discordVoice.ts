/**
 * Minimal Discord voice-state lookup for the recorder tick endpoint. Unlike the
 * cron's request helper this never retries: the recorder polls every couple of
 * seconds, so on a rate limit or outage it is better to answer "unknown" at
 * once and let the client keep its current state than to stall the tick.
 */
const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";
const discordApiBase = "https://discord.com/api/v10";

export const discordVoiceLookupEnabled = () => Boolean(discordBotToken && discordGuildId);

export type VoiceChannelLookup =
  | { ok: true; channelId: string | null }
  | { ok: false; reason: string };

/** The voice channel a guild member is currently in, or null when not in one. */
export const lookupDiscordVoiceChannelId = async (
  discordUserId: string
): Promise<VoiceChannelLookup> => {
  if (!discordVoiceLookupEnabled()) {
    return { ok: false, reason: "Discord is not configured." };
  }
  try {
    const response = await fetch(
      `${discordApiBase}/guilds/${discordGuildId}/voice-states/${discordUserId}`,
      { headers: { Authorization: `Bot ${discordBotToken}` }, cache: "no-store" }
    );
    if (response.status === 404) {
      // "Unknown Voice State": the member is not in any voice channel.
      return { ok: true, channelId: null };
    }
    if (!response.ok) {
      return { ok: false, reason: `Discord API error (${response.status}).` };
    }
    const payload = (await response.json().catch(() => null)) as
      | { channel_id?: string | null }
      | null;
    return { ok: true, channelId: String(payload?.channel_id ?? "").trim() || null };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Voice lookup failed." };
  }
};

/**
 * Whether any of the given accounts (the tutor's main account plus approved
 * extra ones) is in `channelId`. Stops at the first hit to spare Discord calls.
 * `null` means at least one lookup failed before a hit was found.
 */
export const isAnyAccountInVoiceChannel = async (
  discordUserIds: string[],
  channelId: string
): Promise<boolean | null> => {
  let failed = false;
  for (const discordUserId of discordUserIds) {
    const lookup = await lookupDiscordVoiceChannelId(discordUserId);
    if (!lookup.ok) {
      failed = true;
      continue;
    }
    if (lookup.channelId === channelId) {
      return true;
    }
  }
  return failed ? null : false;
};
