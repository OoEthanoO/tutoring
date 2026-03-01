import re
import os

filepath = "src/lib/discordSync.ts"
with open(filepath, "r") as f:
    code = f.read()

# 1. Update Constants
code = code.replace('const defaultCommunityCategoryName = "Community";', 
                    'const defaultTextCategoryName = "Text";\nconst defaultVoiceCategoryName = "Voice";')
code = code.replace('const defaultFounderOnlyChannelName = "founder-only";\n', '')
code = code.replace('const defaultTutorOnlyChannelName = "tutor-only";', 
                    'const defaultExecutivesOnlyChannelName = "executives";\nconst defaultSocialMediaChannelName = "social-media";\nconst defaultScienceTutorsChannelName = "science-tutors";')
code = code.replace('const defaultTutorVoiceChannelName = "Tutor VC";', 
                    'const defaultEveryoneVoiceChannelName = "Everyone";\nconst defaultExecutivesVoiceChannelName = "Executives";\nconst defaultSocialMediaVoiceChannelName = "Social Media";\nconst defaultScienceTutorsVoiceChannelName = "Science Tutors";')

# 2. Update config variable reads
code = code.replace('communityCategoryName', 'textCategoryName')
code = code.replace('DISCORD_COMMUNITY_CATEGORY_NAME', 'DISCORD_TEXT_CATEGORY_NAME')
code = regex = re.sub(r'const founderOnlyChannelName[\s\S]*?defaultFounderOnlyChannelName;', '', code)
code = code.replace('tutorOnlyChannelName', 'executivesOnlyChannelName')
code = code.replace('DISCORD_TUTOR_ONLY_CHANNEL_NAME', 'DISCORD_EXECUTIVES_ONLY_CHANNEL_NAME')
code = code.replace('defaultTutorOnlyChannelName', 'defaultExecutivesOnlyChannelName')

code = code.replace('const tutorVoiceChannelName =\n    String(process.env.DISCORD_TUTOR_VOICE_CHANNEL_NAME ?? "").trim() ||\n    defaultTutorVoiceChannelName;', 
'''const socialMediaChannelName = String(process.env.DISCORD_SOCIAL_MEDIA_CHANNEL_NAME ?? "").trim() || defaultSocialMediaChannelName;
  const scienceTutorsChannelName = String(process.env.DISCORD_SCIENCE_TUTORS_CHANNEL_NAME ?? "").trim() || defaultScienceTutorsChannelName;
  const everyoneVoiceChannelName = String(process.env.DISCORD_EVERYONE_VOICE_CHANNEL_NAME ?? "").trim() || defaultEveryoneVoiceChannelName;
  const executivesVoiceChannelName = String(process.env.DISCORD_EXECUTIVES_VOICE_CHANNEL_NAME ?? "").trim() || defaultExecutivesVoiceChannelName;
  const socialMediaVoiceChannelName = String(process.env.DISCORD_SOCIAL_MEDIA_VOICE_CHANNEL_NAME ?? "").trim() || defaultSocialMediaVoiceChannelName;
  const scienceTutorsVoiceChannelName = String(process.env.DISCORD_SCIENCE_TUTORS_VOICE_CHANNEL_NAME ?? "").trim() || defaultScienceTutorsVoiceChannelName;
  const voiceCategoryName = String(process.env.DISCORD_VOICE_CATEGORY_NAME ?? "").trim() || defaultVoiceCategoryName;''')

# 3. Update build Permission Overwrites functions
# We need to change buildTutorOnlyPermissionOverwrites to buildExecutivesOnlyPermissionOverwrites
code = code.replace('buildTutorOnlyPermissionOverwrites', 'buildExecutivesOnlyPermissionOverwrites')
code = code.replace('(guildId, tutorRoleId, botUserId)', '(guildId, executiveRoleId, botUserId)')
code = code.replace(
'''const buildExecutivesOnlyPermissionOverwrites = (
  guildId: string,
  tutorRoleId: string,
  botUserId: string
): DiscordPermissionOverwrite[] => {''',
'''const buildExecutivesOnlyPermissionOverwrites = (
  guildId: string,
  executiveRoleId: string,
  botUserId: string
): DiscordPermissionOverwrite[] => {'''
)
code = code.replace('id: tutorRoleId', 'id: executiveRoleId')

# Remove buildFounderOnlyPermissionOverwrites completely
code = re.sub(r'const buildFounderOnlyPermissionOverwrites = \([\s\S]*?\];\n\};?\n', '', code)
# Remove buildTutorVoicePermissionOverwrites completely
code = re.sub(r'const buildTutorVoicePermissionOverwrites = \([\s\S]*?\];\n\};?\n', '', code)

# Insert generic Role-Based Overwrites
new_overwrites = '''
const buildRoleExclusiveTextPermissionOverwrites = (
  guildId: string,
  roleId: string,
  botUserId: string,
  extraRoleIds: string[] = []
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(
    viewChannelPermission | sendMessagesPermission | readMessageHistoryPermission
  );

  const overwrites = [
    {
      id: guildId,
      type: 0 as const,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: roleId,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1 as const,
      allow: activeAllow,
      deny: "0",
    },
  ];
  
  for (const extra of extraRoleIds) {
    overwrites.push({
      id: extra,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    });
  }
  
  return overwrites;
};

const buildRoleExclusiveVoicePermissionOverwrites = (
  guildId: string,
  roleId: string,
  botUserId: string,
  extraRoleIds: string[] = []
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(viewChannelPermission | connectPermission);

  const overwrites = [
    {
      id: guildId,
      type: 0 as const,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: roleId,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1 as const,
      allow: activeAllow,
      deny: "0",
    },
  ];
  for (const extra of extraRoleIds) {
    overwrites.push({
      id: extra,
      type: 0 as const,
      allow: activeAllow,
      deny: "0",
    });
  }
  return overwrites;
};
'''
code = code.replace('const sortOverwriteKeys = (overwrites', new_overwrites + '\nconst sortOverwriteKeys = (overwrites')

# Update buildEveryoneChatPermissionOverwrites and Voice equivalent
# Actually wait, we can just use the signature of buildEveryoneChatPermissionOverwrites and add voice

new_voice_everyone = '''
const buildEveryoneVoicePermissionOverwrites = (
  guildId: string,
  studentRoleId: string,
  executiveRoleId: string,
  founderRoleId: string,
  botUserId: string
): DiscordPermissionOverwrite[] => {
  const activeAllow = String(viewChannelPermission | connectPermission);

  return [
    {
      id: guildId,
      type: 0,
      allow: "0",
      deny: String(viewChannelPermission),
    },
    {
      id: studentRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: executiveRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: founderRoleId,
      type: 0,
      allow: activeAllow,
      deny: "0",
    },
    {
      id: botUserId,
      type: 1,
      allow: activeAllow,
      deny: "0",
    },
  ];
};
'''
code = code.replace('const buildExecutivesOnlyPermissionOverwrites', new_voice_everyone + '\nconst buildExecutivesOnlyPermissionOverwrites')


# 4. Roles creation
code = code.replace('const tutorRole = await ensureRole("Tutor", false);', 'const executiveRole = await ensureRole("Executive", false);\n  const socialMediaRole = await ensureRole("Social Media", false);\n  const scienceTutorsRole = await ensureRole("Science Tutors", false);')

code = code.replace('const baseRoleIds = new Set([studentRole.id, tutorRole.id, founderRole.id]);', 
                    'const baseRoleIds = new Set([studentRole.id, executiveRole.id, founderRole.id, socialMediaRole.id, scienceTutorsRole.id]);')

# Replace tutorRole usages
code = code.replace('tutorRole.id', 'executiveRole.id')
code = code.replace('shouldBeTutor', 'shouldBeExecutive')
code = code.replace('websiteRole === "tutor"', 'websiteRole === "executive"')

# Categories
code = code.replace('communityCategory', 'textCategory')
code = code.replace('const coursesCategory = await ensureCategory(coursesCategoryName);', 
                    'const voiceCategory = await ensureCategory(voiceCategoryName);\n  const coursesCategory = await ensureCategory(coursesCategoryName);')

# Channels instantiation
# Remove founderOnlyChannel instantiation
code = re.sub(r'const founderOnlyChannel = await ensureFixedChannel\(\{[\s\S]*?\}\);\n', '', code)
# Replace tutorOnlyChannel instantiation
code = re.sub(r'const tutorOnlyChannel = await ensureFixedChannel\(\{[\s\S]*?\}\);\n', '', code)
# Remove tutorVoiceChannel instantiation
code = re.sub(r'const tutorVoiceChannel = await ensureFixedChannel\(\{[\s\S]*?\}\);\n', '', code)

# Insert the new channel orchestrations
new_channels = '''
  const executivesOnlyChannel = await ensureFixedChannel({
    name: executivesOnlyChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      executiveRoleId,
      botUser.id,
      [founderRole.id]
    ),
  });

  const socialMediaChannel = await ensureFixedChannel({
    name: socialMediaChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      socialMediaRole.id,
      botUser.id,
      [founderRole.id]
    ),
  });

  const scienceTutorsChannel = await ensureFixedChannel({
    name: scienceTutorsChannelName,
    channelType: discordTextChannelType,
    parentId: textCategory.id,
    permissionOverwrites: buildRoleExclusiveTextPermissionOverwrites(
      discordGuildId,
      scienceTutorsRole.id,
      botUser.id,
      [founderRole.id]
    ),
  });

  const everyoneVoiceChannel = await ensureFixedChannel({
    name: everyoneVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildEveryoneVoicePermissionOverwrites(
      discordGuildId,
      studentRole.id,
      executiveRoleId,
      founderRole.id,
      botUser.id
    ),
  });

  const executivesVoiceChannel = await ensureFixedChannel({
    name: executivesVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      executiveRoleId,
      botUser.id,
      [founderRole.id]
    ),
  });

  const socialMediaVoiceChannel = await ensureFixedChannel({
    name: socialMediaVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      socialMediaRole.id,
      botUser.id,
      [founderRole.id]
    ),
  });

  const scienceTutorsVoiceChannel = await ensureFixedChannel({
    name: scienceTutorsVoiceChannelName,
    channelType: discordVoiceChannelType,
    parentId: voiceCategory.id,
    permissionOverwrites: buildRoleExclusiveVoicePermissionOverwrites(
      discordGuildId,
      scienceTutorsRole.id,
      botUser.id,
      [founderRole.id]
    ),
  });
'''
code = code.replace('const enforceCommunityPosition = async (', new_channels + '\n  const enforceCommunityPosition = async (')
code = code.replace('enforceCommunityPosition', 'enforceTextPosition')

# Positioning fixes
code = code.replace('let nextCommunityPosition = 0;', 'let nextTextPosition = 0;')
code = code.replace('nextCommunityPosition += 1;', 'nextTextPosition += 1;')
code = code.replace('nextCommunityPosition', 'nextTextPosition')
code = code.replace(
'''    await enforceTextPosition(
      everyoneChatChannel.id,
      everyoneChatChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }''',
'''    await enforceTextPosition(
      everyoneChatChannel.id,
      everyoneChatChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (executivesOnlyChannel) {
    await enforceTextPosition(
      executivesOnlyChannel.id,
      executivesOnlyChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (socialMediaChannel) {
    await enforceTextPosition(
      socialMediaChannel.id,
      socialMediaChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }
  if (scienceTutorsChannel) {
    await enforceTextPosition(
      scienceTutorsChannel.id,
      scienceTutorsChannelName,
      nextTextPosition
    );
    nextTextPosition += 1;
  }''')

code = re.sub(r'if \(tutorOnlyChannel\) \{[\s\S]*?nextTextPosition \+= 1;\n  \}', '', code)
code = re.sub(r'if \(founderOnlyChannel\) \{[\s\S]*?nextTextPosition \+= 1;\n  \}', '', code)
code = re.sub(r'if \(tutorVoiceChannel\) \{[\s\S]*?nextTextPosition \+= 1;\n  \}', '', code)

# We need enforceVoicePosition
code = code.replace('const enforceTopLevelPosition', '''
  const enforceVoicePosition = async (
    channelId: string,
    label: string,
    position: number
  ) => {
    const existing = mutableChannels.find((channel) => channel.id === channelId);
    if (!existing) {
      return;
    }

    const payload: UpdateGuildChannelPayload = {};
    if (String(existing.parent_id ?? "") !== voiceCategory.id) {
      payload.parent_id = voiceCategory.id;
    }
    if (typeof existing.position !== "number" || existing.position !== position) {
      payload.position = position;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    try {
      const updatedChannel = await apiClient.updateGuildChannel(channelId, payload);
      const channelIndex = mutableChannels.findIndex(
        (channel) => channel.id === channelId
      );
      if (channelIndex >= 0) {
        mutableChannels[channelIndex] = updatedChannel;
      }
      result.updatedChannelCount += 1;
    } catch (error) {
      result.errors.push(
        `Failed to reorder channel "${label}": ${toErrorMessage(
          error,
          "Unknown reorder channel error."
        )}`
      );
    }
  };

  let nextVoicePosition = 0;
  if (everyoneVoiceChannel) {
    await enforceVoicePosition(everyoneVoiceChannel.id, everyoneVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (executivesVoiceChannel) {
    await enforceVoicePosition(executivesVoiceChannel.id, executivesVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (socialMediaVoiceChannel) {
    await enforceVoicePosition(socialMediaVoiceChannel.id, socialMediaVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }
  if (scienceTutorsVoiceChannel) {
    await enforceVoicePosition(scienceTutorsVoiceChannel.id, scienceTutorsVoiceChannelName, nextVoicePosition);
    nextVoicePosition += 1;
  }

  const enforceTopLevelPosition''')

# Fix Top Level Ordering
# textCategory (Community), then Voice, then Courses, then Archived
code = code.replace('''await enforceTopLevelPosition(
    textCategory.id,
    textCategoryName,
    nextTopLevelPosition
  );
  nextTopLevelPosition += 1;
  await enforceTopLevelPosition(
    coursesCategory.id,
    coursesCategoryName,
    nextTopLevelPosition
  );''', 
'''await enforceTopLevelPosition(
    textCategory.id,
    textCategoryName,
    nextTopLevelPosition
  );
  nextTopLevelPosition += 1;
  await enforceTopLevelPosition(
    voiceCategory.id,
    voiceCategoryName,
    nextTopLevelPosition
  );
  nextTopLevelPosition += 1;
  await enforceTopLevelPosition(
    coursesCategory.id,
    coursesCategoryName,
    nextTopLevelPosition
  );''')

# Filter allowed text channels
code = code.replace('if (tutorOnlyChannel) {\n    allowedTextChannelIds.add(tutorOnlyChannel.id);\n  }', '')
code = code.replace('if (founderOnlyChannel) {\n    allowedTextChannelIds.add(founderOnlyChannel.id);\n  }', '')
code = code.replace('const allowedVoiceChannelIds = new Set<string>();', 
'''
  if (executivesOnlyChannel) allowedTextChannelIds.add(executivesOnlyChannel.id);
  if (socialMediaChannel) allowedTextChannelIds.add(socialMediaChannel.id);
  if (scienceTutorsChannel) allowedTextChannelIds.add(scienceTutorsChannel.id);
  
  const allowedVoiceChannelIds = new Set<string>();''')

code = code.replace('if (tutorVoiceChannel) {\n    allowedVoiceChannelIds.add(tutorVoiceChannel.id);\n  }', 
'''if (everyoneVoiceChannel) allowedVoiceChannelIds.add(everyoneVoiceChannel.id);
  if (executivesVoiceChannel) allowedVoiceChannelIds.add(executivesVoiceChannel.id);
  if (socialMediaVoiceChannel) allowedVoiceChannelIds.add(socialMediaVoiceChannel.id);
  if (scienceTutorsVoiceChannel) allowedVoiceChannelIds.add(scienceTutorsVoiceChannel.id);''')

# Add voiceCategory to allowedCategoryIds
code = code.replace('const allowedCategoryIds = new Set<string>([\\n    textCategory.id,', 'const allowedCategoryIds = new Set<string>([\\n    textCategory.id,\\n    voiceCategory.id,')


with open(filepath, "w") as f:
    f.write(code)
print("discordSync.ts rewritten")
