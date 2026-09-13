import { describe, expect, it } from "vitest";
import { mirrorLeadershipAccess, orderLeadershipRoles, shadowDiscordPermissions } from "./leadershipDiscord";

describe("Discord leadership protection", () => {
  it("places both shadows below both leaders, regardless of their previous positions", () => {
    const names = ["CEO Shadow", "COO Shadow", "Executive", "CEO", "COO", "Founder", "yanbot"];
    const ordered = orderLeadershipRoles(names.map((name, i) => ({ id: name, name, position: 100 - i, managed: name === "yanbot" })));
    expect(ordered.map((r) => r.name)).toEqual(["Executive", "COO Shadow", "CEO Shadow", "COO", "CEO", "Founder", "yanbot"]);
  });
  it("copies CEO/COO channel access without granting channel permission overrides", () => {
    const original = [{ id: "ceo", type: 0 as const, allow: String(1024 + 2048 + 16 + 268435456), deny: "0" },
      { id: "coo", type: 0 as const, allow: "1049600", deny: "2048" },
      { id: "bot", type: 1 as const, allow: "16", deny: "0" }];
    const result = mirrorLeadershipAccess(original, [{ leaderId: "ceo", shadowId: "ceo-shadow" }, { leaderId: "coo", shadowId: "coo-shadow" }]);
    expect(result).toContainEqual({ id: "ceo-shadow", type: 0, allow: "3072", deny: "0" });
    expect(result).toContainEqual({ id: "coo-shadow", type: 0, allow: "1049600", deny: "2048" });
    expect(result.slice(0, 3)).toEqual(original);
    expect(original).toHaveLength(3);
  });
  it("never copies administrator or powers that can bypass protection through channel overwrites", () => {
    const permissions = BigInt(shadowDiscordPermissions("8"));
    for (const bit of [3, 4, 5, 22, 23, 24, 28, 29]) expect(permissions & (BigInt(1) << BigInt(bit))).toBe(BigInt(0));
    for (const bit of [1, 2, 10, 11, 13, 20, 21, 27, 40]) expect(permissions & (BigInt(1) << BigInt(bit))).not.toBe(BigInt(0));
    expect(shadowDiscordPermissions("3072")).toBe("3072");
  });
});
