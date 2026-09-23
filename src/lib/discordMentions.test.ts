import { describe, expect, it } from "vitest";
import {
  grantsMentionEveryone,
  mentionEveryonePermission,
  planMentionEveryone,
  setMentionEveryone,
  withoutEveryoneMentions,
} from "./discordMentions";

const bit = mentionEveryonePermission;
const withBit = (base: bigint) => (base | bit).toString();
const viewAndSend = BigInt(1024 + 2048);

const guildId = "guild";
const roles = {
  everyone: { id: guildId, name: "@everyone", permissions: withBit(viewAndSend) },
  founder: { id: "founder", name: "Founder", permissions: viewAndSend.toString() },
  ceo: { id: "ceo", name: "CEO", permissions: withBit(viewAndSend) },
  coo: { id: "coo", name: "COO", permissions: viewAndSend.toString() },
  executive: { id: "exec", name: "Executive", permissions: withBit(viewAndSend) },
  pending: { id: "pending", name: "Pending", permissions: viewAndSend.toString() },
  chief: { id: "chief", name: "Chief Executive", permissions: withBit(viewAndSend) },
  bot: { id: "bot", name: "yanbot", managed: true, permissions: withBit(viewAndSend) },
};
const leaders = new Set(["founder", "ceo", "coo"]);

type TestRole = { id: string; name: string; managed?: boolean; permissions?: string };

const planFor = (list: TestRole[] = Object.values(roles), botRoleIds = new Set(["bot"])) =>
  planMentionEveryone({ roles: list, guildId, leaderRoleIds: leaders, botRoleIds });

const updateFor = (plan: ReturnType<typeof planFor>, roleId: string) =>
  plan.updates.find((update) => update.roleId === roleId);

describe("setMentionEveryone", () => {
  it("changes only the one bit", () => {
    expect(setMentionEveryone(withBit(viewAndSend), false)).toBe(viewAndSend.toString());
    expect(setMentionEveryone(viewAndSend.toString(), true)).toBe(withBit(viewAndSend));
  });
});

describe("grantsMentionEveryone", () => {
  it("counts Administrator, which implies every permission", () => {
    expect(grantsMentionEveryone("8")).toBe(true);
    expect(grantsMentionEveryone(viewAndSend.toString())).toBe(false);
  });
});

describe("planMentionEveryone", () => {
  it("takes the permission off @everyone and every role outside the trio", () => {
    const plan = planFor();
    for (const id of [guildId, "exec", "chief"]) {
      expect(updateFor(plan, id)?.permissions).toBe(viewAndSend.toString());
    }
    // Pending never had it, so there is nothing to change.
    expect(updateFor(plan, "pending")).toBeUndefined();
  });

  it("gives it to the Founder, CEO and COO", () => {
    const plan = planFor();
    expect(updateFor(plan, "founder")?.permissions).toBe(withBit(viewAndSend));
    expect(updateFor(plan, "coo")?.permissions).toBe(withBit(viewAndSend));
    // The CEO already has it.
    expect(updateFor(plan, "ceo")).toBeUndefined();
  });

  it("leaves YanBot's roles alone", () => {
    const unmanagedBotRole = { id: "botextra", name: "Bots", permissions: withBit(viewAndSend) };
    const plan = planFor([...Object.values(roles), unmanagedBotRole], new Set(["bot", "botextra"]));
    expect(updateFor(plan, "bot")).toBeUndefined();
    expect(updateFor(plan, "botextra")).toBeUndefined();
  });

  it("keeps @everyone when that is the only place YanBot gets the permission", () => {
    const botWithout = { ...roles.bot, permissions: viewAndSend.toString() };
    const plan = planFor([...Object.values(roles).filter((r) => r.id !== "bot"), botWithout]);
    expect(updateFor(plan, guildId)).toBeUndefined();
    expect(plan.everyoneRoleKept).toBe(true);
    // Everything else is still fixed.
    expect(updateFor(plan, "exec")).toBeDefined();
  });

  it("counts a bot with Administrator as keeping the permission", () => {
    const adminBot = { ...roles.bot, permissions: "8" };
    const plan = planFor([...Object.values(roles).filter((r) => r.id !== "bot"), adminBot]);
    expect(updateFor(plan, guildId)).toBeDefined();
    expect(plan.everyoneRoleKept).toBe(false);
  });

  it("reports roles outside the trio that have Administrator", () => {
    const adminExec = { ...roles.executive, permissions: (BigInt(8) | viewAndSend).toString() };
    const plan = planFor([...Object.values(roles).filter((r) => r.id !== "exec"), adminExec]);
    expect(plan.administratorRoleNames).toEqual(["Executive"]);
  });

  it("never writes to a role whose permissions it could not read", () => {
    const unknown = { id: "mystery", name: "Mystery" };
    const plan = planFor([...Object.values(roles), unknown]);
    expect(updateFor(plan, "mystery")).toBeUndefined();
  });

  it("changes nothing once the guild is already right", () => {
    const settled = planFor().updates.reduce<TestRole[]>(
      (list, update) =>
        list.map((role) => (role.id === update.roleId ? { ...role, permissions: update.permissions } : role)),
      Object.values(roles)
    );
    expect(planFor(settled).updates).toEqual([]);
  });
});

describe("withoutEveryoneMentions", () => {
  it("lets users and roles ping but never @everyone or @here", () => {
    expect(withoutEveryoneMentions.parse).toEqual(["users", "roles"]);
    expect(withoutEveryoneMentions.parse).not.toContain("everyone");
  });
});
