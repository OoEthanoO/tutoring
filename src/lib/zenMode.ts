import type { DiscordPermissionOverwrite } from "@/lib/discordLiveChannels";

const bit = (n: number) => BigInt(1) << BigInt(n);
export const speakBit = bit(21);
// Prevent microphone, stream audio and soundboard bypasses. Class discussion
// belongs in the course text channel, not the voice channel's attached chat.
export const zenBlockedBits = speakBit | bit(9) | bit(42) | bit(45) | bit(11) | bit(38) | bit(46);
const joinBits = bit(10) | bit(20);
export type ZenPermissionSnapshot = Record<string, { allow: string; deny: string }>;
const key = (o: DiscordPermissionOverwrite) => `${o.type}:${o.id}`;

export function snapshotZenPermissions(overwrites: DiscordPermissionOverwrite[]): ZenPermissionSnapshot {
  return Object.fromEntries(overwrites.map(o => [key(o), {
    allow: String(BigInt(o.allow) & zenBlockedBits), deny: String(BigInt(o.deny) & zenBlockedBits),
  }]));
}

export function applyZenPermissions(overwrites: DiscordPermissionOverwrite[], speakerIds: Set<string>, speakerRoleIds: Set<string>): DiscordPermissionOverwrite[] {
  const entries = [...overwrites];
  for (const id of speakerIds) {
    if (!entries.some(o => o.type === 1 && o.id === id)) entries.push({ id, type: 1, allow: "0", deny: "0" });
  }
  return entries.map(o => {
    const speaker = o.type === 1 ? speakerIds.has(o.id) : speakerRoleIds.has(o.id);
    return { ...o,
      allow: String(speaker ? BigInt(o.allow) | zenBlockedBits : BigInt(o.allow) & ~zenBlockedBits),
      deny: String(speaker ? BigInt(o.deny) & ~zenBlockedBits : BigInt(o.deny) | zenBlockedBits),
    };
  });
}

export function restoreZenPermissions(overwrites: DiscordPermissionOverwrite[], snapshot: ZenPermissionSnapshot): DiscordPermissionOverwrite[] {
  return overwrites.map(o => {
    // An entry added while Zen was active (e.g. a new trial) has the usual
    // managed-channel speak permission if it grants entry; other bits inherit.
    const previous = snapshot[key(o)] ?? {
      allow: String((BigInt(o.allow) & joinBits) === joinBits ? speakBit : BigInt(0)), deny: "0",
    };
    return { ...o, allow: String((BigInt(o.allow) & ~zenBlockedBits) | BigInt(previous.allow)),
      deny: String((BigInt(o.deny) & ~zenBlockedBits) | BigInt(previous.deny)) };
  }).filter(o => snapshot[key(o)] || o.allow !== "0" || o.deny !== "0");
}
