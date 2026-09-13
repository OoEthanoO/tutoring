type Overwrite = { id: string; type: 0 | 1; allow: string; deny: string };
type Role = { id: string; name: string; position?: number; managed?: boolean };

// These powers can bypass role hierarchy through channel/member overwrites,
// server configuration, or voice moderation. Use the protected website tools
// for access changes instead. Discord hierarchy alone cannot constrain them.
const unsafeShadowPermissions = [3, 4, 5, 22, 23, 24, 28, 29]
  .reduce((mask, bit) => mask | (BigInt(1) << BigInt(bit)), BigInt(0));
const knownPermissions = [...Array.from({ length: 47 }, (_, i) => i), 48, 49, 50, 51, 52]
  .reduce((mask, bit) => mask | (BigInt(1) << BigInt(bit)), BigInt(0));

export const shadowDiscordPermissions = (permissions: string): string => {
  const source = BigInt(permissions);
  const expanded = source & BigInt(8) ? knownPermissions : source;
  return (expanded & ~unsafeShadowPermissions).toString();
};

export function mirrorLeadershipAccess(
  overwrites: Overwrite[], pairs: { leaderId: string; shadowId: string }[],
): Overwrite[] {
  const result = [...overwrites];
  for (const { leaderId, shadowId } of pairs) {
    const source = overwrites.find((o) => o.type === 0 && o.id === leaderId);
    if (!source) continue;
    const copy = { ...source, id: shadowId, allow: (BigInt(source.allow) & ~unsafeShadowPermissions).toString() };
    const existing = result.findIndex((o) => o.type === 0 && o.id === shadowId);
    if (existing < 0) result.push(copy);
    else result[existing] = copy;
  }
  return result;
}

/** Ascending Discord order: both shadows stay below both protected leaders. */
export function orderLeadershipRoles<T extends Role>(roles: T[]): T[] {
  const priority = (role: T) => {
    if (role.managed) return 200; // Bot/integration roles must remain usable.
    switch (role.name.trim().toLowerCase()) {
      case "founder": return 103;
      case "ceo": return 102;
      case "coo": return 101;
      case "ceo shadow": return 92;
      case "coo shadow": return 91;
      default: return 0;
    }
  };
  return [...roles].sort((a, b) => priority(a) - priority(b) || (a.position ?? 0) - (b.position ?? 0));
}
