import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const bundle = vi.hoisted(() => ({
  repository: "OoEthanoO/tutoring",
  total: 0,
  commits: [] as {
    hash: string; message: string; author: string; date: string;
    added: number; removed: number; files: number;
  }[],
}));
vi.mock("@/generated/commits.json", () => ({ default: bundle }));

const commit = (n: number) => ({
  hash: n.toString(16).padStart(7, "0").padEnd(40, "0"),
  message: `Change ${n}\n\nDetails preserved.`,
  author: "Test Author", date: "2026-09-30T12:00:00Z",
  added: 12, removed: 3, files: 2,
});
type Post = { content: string; allowed_mentions: { parse: string[] } };
let messages: { content: string }[];
let posts: Post[];
let failReads: boolean;
let failSends: boolean;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("DISCORD_GUILD_ID", "test-guild");
  vi.stubEnv("DISCORD_COMMITS_CHANNEL_NAME", "");
  vi.stubEnv("GITHUB_REPOSITORY_FULL_NAME", "OoEthanoO/tutoring");
  vi.stubEnv("GITHUB_TOKEN", "");
  bundle.repository = "OoEthanoO/tutoring";
  bundle.total = 3;
  bundle.commits = [commit(3), commit(2), commit(1)];
  messages = [{ content: "**Commit #1:** `0000001` by Test Author" }];
  posts = [];
  failReads = failSends = false;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/guilds/test-guild/channels")) {
      return Response.json([{ id: "commits-id", name: "commits", type: 0 }]);
    }
    if (url.includes("/channels/commits-id/messages")) {
      if (init?.method === "POST") {
        if (failSends) return new Response(null, { status: 500 });
        const body = JSON.parse(String(init.body)) as Post;
        posts.push(body);
        messages.unshift({ content: body.content });
        return Response.json({ id: "message-id" });
      }
      return failReads ? new Response(null, { status: 403 }) : Response.json(messages);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function sync() {
  const { runGithubSync } = await import("./githubSync");
  const result = runGithubSync();
  await vi.runAllTimersAsync();
  return result;
}

describe("commit announcements without a GitHub token", () => {
  it("catches up oldest first with author, date, stats, and no GitHub calls or pings", async () => {
    expect(await sync()).toMatchObject({ success: true, processed: 2, errors: [] });
    expect(posts.map((post) => post.content.split("\n")[0])).toEqual([
      "**Commit #2:** `0000002` by Test Author",
      "**Commit #3:** `0000003` by Test Author",
    ]);
    expect(posts[0].content).toContain("Change 2\n\nDetails preserved.");
    expect(posts[0].content).toContain("<t:1790769600:f>");
    expect(posts[0].content).toContain("**2** files changed, **12** insertions(+), **3** deletions(-)");
    expect(posts.every((post) => post.allowed_mentions.parse.length === 0)).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("https://discord.com/"))).toBe(true);
    expect(await sync()).toMatchObject({ success: true, processed: 0 });
    expect(posts).toHaveLength(2);
  });

  it("recognizes an existing full SHA as well as abbreviated SHAs", async () => {
    messages = [{ content: `**Commit #2:** \`${commit(2).hash}\`` }];
    expect(await sync()).toMatchObject({ success: true, processed: 1 });
    expect(posts[0].content).toContain("Commit #3:");
  });

  it("continues a backlog larger than one tick without dropping or repeating commits", async () => {
    bundle.total = 22;
    bundle.commits = Array.from({ length: 22 }, (_, i) => commit(22 - i));
    expect(await sync()).toMatchObject({ processed: 15 });
    expect(posts[0].content).toContain("Commit #2:");
    expect(posts.at(-1)?.content).toContain("Commit #16:");
    expect(await sync()).toMatchObject({ processed: 6 });
    expect(posts.at(-1)?.content).toContain("Commit #22:");
    expect(new Set(posts.map((post) => post.content)).size).toBe(21);
    expect(await sync()).toMatchObject({ processed: 0 });
  });

  it.each([{ history: [] }, { history: [{ content: "**Commit #99:** `fffffff`" }] }])(
    "starts with only the latest commit when channel history has no matching anchor: %j", async ({ history }) => {
      messages = history;
      expect(await sync()).toMatchObject({ processed: 1 });
      expect(posts[0].content).toContain("Commit #3:");
    },
  );

  it("does not send duplicates when Discord history cannot be read", async () => {
    failReads = true;
    const result = await sync();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("avoid duplicates");
    expect(posts).toHaveLength(0);
  });

  it("retries a failed commit before advancing to later commits", async () => {
    failSends = true;
    expect(await sync()).toMatchObject({ success: false, processed: 0 });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    failSends = false;
    expect(await sync()).toMatchObject({ success: true, processed: 2 });
    expect(posts[0].content).toContain("Commit #2:");
  });

  it("does not post this build's history for a different configured repository", async () => {
    vi.stubEnv("GITHUB_REPOSITORY_FULL_NAME", "another/project");
    expect(await sync()).toMatchObject({ success: false, processed: 0, skippedReason: expect.stringContaining("No bundled commits") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a long commit within Discord's message limit", async () => {
    bundle.commits[1].message = "@everyone " + "x".repeat(2400);
    await sync();
    expect(posts[0].content).toHaveLength(2000);
    expect(posts[0].content).toContain("Commit #2:");
    expect(posts[0].allowed_mentions).toEqual({ parse: [] });
  });

  it("retains authenticated GitHub polling when a token is configured", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-github-token");
    const discordFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.startsWith("https://api.github.com/")) return discordFetch(url, init);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-github-token" });
      if (url.includes("?per_page=")) return Response.json([commit(3), commit(2), commit(1)].map((entry) => ({
        sha: entry.hash, commit: { message: entry.message, author: { name: entry.author, date: entry.date } }, author: null,
      })));
      return Response.json({ stats: { additions: 12, deletions: 3 }, files: [{}, {}] });
    });
    expect(await sync()).toMatchObject({ success: true, processed: 2 });
    expect(posts[0].content).toContain("Commit #2:");
  });
});
