const fs = require('fs');
const file = 'src/lib/discordSync.ts';
let content = fs.readFileSync(file, 'utf-8');

content = content.replace(
  /const buildFoundersPermissionOverwrites = \([\s\S]*?\];\n};/g,
  `const buildFoundersPermissionOverwrites = (
  guildId: string,
  founderRoleId: string,
  botUserId: string,
  cooRoleId: string,
  ceoRoleId: string,
  chiefExecutiveRoleId: string
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(
    viewChannelPermission | readMessageHistoryPermission | sendMessagesPermission
  );

  return [
    { id: guildId, type: 0, allow: "0", deny: String(viewChannelPermission) },
    { id: founderRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: cooRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: ceoRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: chiefExecutiveRoleId, type: 0, allow: activeAllow, deny: "0" },
    { id: botUserId, type: 1, allow: activeAllow, deny: "0" },
  ];
};`
);

content = content.replace(
  /permissionOverwrites: buildFoundersPermissionOverwrites\([\s\S]*?id\n    \)/g,
  `permissionOverwrites: buildFoundersPermissionOverwrites(
      discordGuildId,
      founderRole.id,
      botUser.id,
      cooRole.id,
      ceoRole.id,
      chiefExecutiveRole.id
    )`
);

// We should also patch other permissions like [founderRole.id] into arrays

content = content.replace(
  /\[founderRole\.id\]/g,
  `[founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id]`
);

content = content.replace(
  /\[founderRole\.id\, juniorExecutiveRole\.id\]/g,
  `[founderRole.id, cooRole.id, ceoRole.id, chiefExecutiveRole.id, juniorExecutiveRole.id]`
);

// Also tasks, commits, everyone etc to include COO/CEO
fs.writeFileSync(file, content);
