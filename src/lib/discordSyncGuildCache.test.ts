import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchDiscordGuildMemberIds keeps a module-scoped cache, so each test gets a
// fresh module instance via resetModules + dynamic import.
const importFetchGuildMemberIds = async () => {
  const mod = await import("@/lib/discordSync");
  return mod.fetchDiscordGuildMemberIds;
};

const memberPage = (ids: string[]) =>
  ids.map((id) => ({ user: { id, username: `user-${id}` } }));

const stubFetchWithMembers = (ids: string[]) => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(memberPage(ids)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchDiscordGuildMemberIds", () => {
  it("returns null when Discord is not configured", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const fetchMock = stubFetchWithMembers(["1"]);
    const fetchGuildMemberIds = await importFetchGuildMemberIds();

    expect(await fetchGuildMemberIds()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("collects member ids from the guild", async () => {
    stubFetchWithMembers(["1", "2"]);
    const fetchGuildMemberIds = await importFetchGuildMemberIds();

    const ids = await fetchGuildMemberIds();
    expect(ids).toEqual(new Set(["1", "2"]));
  });

  it("returns null when the Discord API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server error", { status: 500 }))
    );
    const fetchGuildMemberIds = await importFetchGuildMemberIds();

    expect(await fetchGuildMemberIds()).toBeNull();
  });

  it("refetches on every call by default", async () => {
    const fetchMock = stubFetchWithMembers(["1"]);
    const fetchGuildMemberIds = await importFetchGuildMemberIds();

    await fetchGuildMemberIds();
    await fetchGuildMemberIds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses the cached result within maxAgeMs", async () => {
    const fetchMock = stubFetchWithMembers(["1"]);
    const fetchGuildMemberIds = await importFetchGuildMemberIds();

    const first = await fetchGuildMemberIds({ maxAgeMs: 60_000 });
    const second = await fetchGuildMemberIds({ maxAgeMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("serves cached data to maxAgeMs callers even when refreshed by a fresh caller", async () => {
    const fetchMock = stubFetchWithMembers(["1"]);
    const fetchGuildMemberIds = await importFetchGuildMemberIds();

    await fetchGuildMemberIds();
    const cached = await fetchGuildMemberIds({ maxAgeMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(new Set(["1"]));
  });
});
