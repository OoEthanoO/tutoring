import { NextResponse, type NextRequest } from "next/server";

const discordBotToken = process.env.DISCORD_BOT_TOKEN ?? "";
const discordGuildId = process.env.DISCORD_GUILD_ID ?? "";
const githubToken = process.env.GITHUB_TOKEN ?? "";
const targetChannelName =
  String(process.env.DISCORD_COMMITS_CHANNEL_NAME ?? "").trim() || "commits";

interface GithubCommit {
  id: string;
  message: string;
  url: string;
  author: {
    name: string;
    email: string;
    username?: string;
  };
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
        body: JSON.stringify({ content }),
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

const fetchCommitStats = async (repoFullName: string, commitId: string) => {
  if (!githubToken) {
    return null;
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/commits/${commitId}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data?.stats as { additions?: number; deletions?: number } | undefined;
  } catch (err) {
    return null;
  }
};

export async function POST(request: NextRequest) {
  const event = request.headers.get("x-github-event");
  
  if (event !== "push") {
    return NextResponse.json({ skipped: true, reason: "Not a push event" });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const commits = body?.commits as GithubCommit[] | undefined;
  const repoFullName = body?.repository?.full_name as string | undefined;

  if (!commits || commits.length === 0 || !repoFullName) {
    return NextResponse.json({ skipped: true, reason: "No commits or repo data" });
  }

  if (!discordBotToken || !discordGuildId) {
    return NextResponse.json(
      { error: "Discord credentials missing" },
      { status: 500 }
    );
  }

  let channels;
  try {
    channels = await listDiscordGuildChannels();
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load guild channels" },
      { status: 500 }
    );
  }

  const commitsChannel = channels.find(
    (ch) => ch.type === 0 && ch.name === targetChannelName
  );

  if (!commitsChannel) {
    return NextResponse.json(
      { error: `Channel #${targetChannelName} not found` },
      { status: 404 }
    );
  }

  // To prevent overwhelming Discord, send a combined message if too many commits.
  // We'll process up to 10 commits, limit payload chunk.
  const activeCommits = commits.slice(0, 10);
  
  for (const commit of activeCommits) {
    const stats = await fetchCommitStats(repoFullName, commit.id);
    const shortId = commit.id.substring(0, 7);
    const messageLines = commit.message.split("\n").filter((l) => l.trim().length > 0);
    const title = messageLines[0] ?? commit.message;

    let text = `📝 **New Commit:** \`${shortId}\` by ${commit.author.username || commit.author.name}\n> ${title}`;
    
    if (stats) {
      const added = stats.additions ?? 0;
      const removed = stats.deletions ?? 0;
      text += `\n📊 Lines: **+${added}** / **-${removed}**`;
    }

    try {
      await sendDiscordMessage(commitsChannel.id, text);
    } catch (err) {
      console.error("Failed to stream commit to Discord", err);
    }
  }

  return NextResponse.json({ success: true, count: activeCommits.length });
}
