import { describe, expect, it } from "vitest";
import { buildLiveVoicePermissionOverwrites } from "./discordLiveChannels";
import { applyZenPermissions, restoreZenPermissions, snapshotZenPermissions, speakBit, zenBlockedBits } from "./zenMode";
const baseline = () => buildLiveVoicePermissionOverwrites({ guildId: "guild", botUserId: "bot", tutorDiscordUserId: "tutor",
  ceoRoleId: "ceo-role", cooRoleId: null, trialDiscordUserIds: ["trial"], courseRoleId: "course-role" });
describe("Zen permissions", () => {
  it("blocks student speech and audio/chat bypasses while preserving entry and tutor speech", () => {
    const original = baseline(), next = applyZenPermissions(original, new Set(["tutor", "co-tutor", "bot"]), new Set(["ceo-role"]));
    for (const id of ["course-role", "trial", "guild"]) {
      const row = next.find(o => o.id === id)!;
      expect(BigInt(row.allow) & zenBlockedBits).toBe(BigInt(0));
      expect(BigInt(row.deny) & zenBlockedBits).toBe(zenBlockedBits);
      expect(BigInt(row.allow) & BigInt(1049600)).toBe(BigInt(original.find(o => o.id === id)!.allow) & BigInt(1049600));
    }
    for (const id of ["tutor", "co-tutor", "bot", "ceo-role"]) expect(BigInt(next.find(o => o.id === id)!.allow) & speakBit).toBe(speakBit);
  });
  it("restores only voice-related bits and never resurrects an expired trial's access", () => {
    const original = baseline(), snapshot = snapshotZenPermissions(original);
    const next = applyZenPermissions(original, new Set(["tutor", "bot", "co-tutor"]), new Set(["ceo-role"]));
    expect(restoreZenPermissions(next, snapshot)).toEqual(original);
    const revoked = next.filter(o => o.id !== "trial");
    expect(restoreZenPermissions(revoked, snapshot).some(o => o.id === "trial")).toBe(false);
  });
  it("restores a new trial added during Zen to normal student voice access", () => {
    const original = baseline().filter(o => o.id !== "trial");
    const next = applyZenPermissions(baseline(), new Set(["tutor", "bot"]), new Set());
    expect(BigInt(restoreZenPermissions(next, snapshotZenPermissions(original)).find(o => o.id === "trial")!.allow) & speakBit).toBe(speakBit);
  });
});
