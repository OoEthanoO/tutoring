import commitsData from "@/generated/commits.json";
const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";
const githubToken = process.env.GITHUB_TOKEN ?? "";
const targetChannelName =
  String(process.env.DISCORD_COMMITS_CHANNEL_NAME ?? "").trim() || "commits";
const repoFullName =
  String(process.env.GITHUB_REPOSITORY_FULL_NAME ?? "").trim() ||
  "OoEthanoO/tutoring";

interface GithubCommitNode {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date?: string;
    };
  };
  author: {
    login: string;
  } | null;
}

interface GithubUserProfile {
  login: string;
  name: string | null;
}

const listDiscordGuildChannels = async () => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${discordGuildId}/channels`,
      {
        headers: {
          Authorization: `Bot ${discordBotToken}`,
        },
        cache: "no-store",
      }
    );
    if (!response.ok) {
      if (response.status === 429 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw new Error(`Failed to list Discord channels (${response.status})`);
    }
    return response.json() as Promise<any[]>;
  }
  throw new Error("Discord API retry limit exceeded.");
};

const getDiscordChannelMessages = async (channelId: string) => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=50`,
      {
        headers: {
          Authorization: `Bot ${discordBotToken}`,
        },
        cache: "no-store",
      }
    );
    if (!response.ok) {
      if (response.status === 429 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return null;
    }
    return response.json() as Promise<{ content: string }[]>;
  }
  return null;
};

const sendDiscordMessage = async (channelId: string, content: string) => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${discordBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, flags: 4096 }),
      }
    );
    if (!response.ok) {
      if (response.status === 429 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw new Error(`Failed to send Discord message (${response.status})`);
    }
    return;
  }
};

const fetchRecentCommits = async (repo: string) => {
  if (!githubToken) {
    return [];
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=15`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
      }
    );
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as GithubCommitNode[];
  } catch {
    return [];
  }
};

const githubDisplayNameCache = new Map<string, string>();

const fetchGithubDisplayName = async (login?: string | null) => {
  if (!login) {
    return null;
  }

  const cached = githubDisplayNameCache.get(login.toLowerCase());
  if (cached) {
    return cached;
  }

  if (!githubToken) {
    return login;
  }

  try {
    const response = await fetch(`https://api.github.com/users/${login}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return login;
    }

    const profile = (await response.json()) as GithubUserProfile;
    const displayName = profile.name?.trim() || profile.login || login;
    githubDisplayNameCache.set(login.toLowerCase(), displayName);
    return displayName;
  } catch {
    return login;
  }
};

const fetchCommitStats = async (repo: string, sha: string) => {
  if (!githubToken) {
    return null;
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/commits/${sha}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
      }
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return {
      additions: data?.stats?.additions,
      deletions: data?.stats?.deletions,
      files: Array.isArray(data?.files) ? data.files.length : undefined
    };
  } catch {
    return null;
  }
};

export type GithubSyncResult = {
  success: boolean;
  processed: number;
  skippedReason: string | null;
  errors: string[];
};

export const runGithubSync = async (): Promise<GithubSyncResult> => {
  const result: GithubSyncResult = {
    success: false,
    processed: 0,
    skippedReason: null,
    errors: [],
  };

  if (!discordBotToken || !discordGuildId) {
    result.skippedReason = "Discord credentials missing";
    return result;
  }

  if (!githubToken) {
    result.skippedReason = "GitHub token missing";
    return result;
  }

  let channels;
  try {
    channels = await listDiscordGuildChannels();
  } catch (err: any) {
    result.errors.push(`Failed to load guild channels: ${err?.message}`);
    return result;
  }

  const commitsChannel = channels.find(
    (ch) => ch.type === 0 && ch.name === targetChannelName
  );

  if (!commitsChannel) {
    result.errors.push(`Channel #${targetChannelName} not found`);
    return result;
  }

  // Find the last handled commit by looking through the channel messages
  const recentMessages = await getDiscordChannelMessages(commitsChannel.id);
  if (recentMessages === null) {
    result.errors.push("Failed to fetch recent messages from Discord channel; skipping sync to avoid duplicates.");
    return result;
  }

  const syncedShas = new Set<string>();
  
  for (const msg of recentMessages) {
    // Robust regex to find the commit SHA (7-40 hex chars) in various bolding formats
    const match = msg.content.match(/(?:New Commit:|Commit #\d+:|\*\*New Commit:\*\*|\*\*Commit #\d+:\*\*)\s*\`([a-f0-9]{7,40})\`/i);
    if (match && match[1]) {
      syncedShas.add(match[1].toLowerCase());
    }
  }

  const githubCommits = await fetchRecentCommits(repoFullName);
  
  if (githubCommits.length === 0) {
    result.skippedReason = "No commits fetched from GitHub";
    result.success = true;
    return result;
  }

  // We loop backward so we push older commits before newer commits
  const unseenCommits = [];
  for (const gc of githubCommits) {
    const shortSha = gc.sha.substring(0, 7).toLowerCase();
    if (syncedShas.has(shortSha)) {
      break; 
    }
    unseenCommits.push(gc);
  }

  // Reverse so the oldest unseen commit pushes first!
  unseenCommits.reverse();

  // If we couldn't find ANY match in the discord channel, limit to max 1 latest commit
  let commitsToProcess = unseenCommits;
  if (syncedShas.size === 0 && unseenCommits.length > 0) {
    commitsToProcess = [unseenCommits[unseenCommits.length - 1]];
  }

  let successfulPushes = 0;
  
    const getCommitNumber = (sha: string) => {
      const foundIdx = commitsData.commits.findIndex((c: { hash: string }) => c.hash === sha);
      if (foundIdx !== -1) {
        return commitsData.total - foundIdx;
      }
      const githubIdx = githubCommits.findIndex(c => c.sha === sha);
      if (githubIdx !== -1) {
        for (let i = githubIdx + 1; i < githubCommits.length; i++) {
          const knownIdx = commitsData.commits.findIndex((c: { hash: string }) => c.hash === githubCommits[i].sha);
          if (knownIdx !== -1) {
            return commitsData.total - knownIdx + (i - githubIdx);
          }
        }
        return commitsData.total + (githubCommits.length - githubIdx);
      }
      return "?";
    };

    for (const commit of commitsToProcess) {
    const stats = await fetchCommitStats(repoFullName, commit.sha);
    const shortId = commit.sha.substring(0, 7);
    const authorName = (await fetchGithubDisplayName(commit.author?.login)) || commit.commit.author.name || "Unknown";

    const commitDate = commit.commit.author.date
      ? new Date(commit.commit.author.date).toLocaleString("en-US", {
          timeZone: "America/Toronto",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

    const commitNumber = getCommitNumber(commit.sha);
      const fullMessage = commit.commit.message.trim();
      let text = `**Commit #${commitNumber}:** \`${shortId}\` by ${authorName}\n${fullMessage}`;
    if (commitDate) {
      text += `\n${commitDate}`;
    }
    if (stats) {
      const added = stats.additions ?? 0;
      const removed = stats.deletions ?? 0;
      const filesChanged = stats.files ?? 0;
        
        const filesText = filesChanged === 1 ? "file" : "files";
        const insertionsText = added === 1 ? "insertion" : "insertions";
        const deletionsText = removed === 1 ? "deletion" : "deletions";
        
        text += `\n**${filesChanged}** ${filesText} changed, **${added}** ${insertionsText}(+), **${removed}** ${deletionsText}(-)`;
      }

      try {
        await sendDiscordMessage(commitsChannel.id, text);
        successfulPushes += 1;
      // Sleep slightly longer inside background sync
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err: any) {
      result.errors.push(`Failed to stream commit ${shortId}: ${err?.message}`);
    }
  }

  result.processed = successfulPushes;
  result.success = true;
  return result;
};
