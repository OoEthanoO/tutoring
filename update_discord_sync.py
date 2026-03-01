import re
import sys

def modify_discordSync():
    path = "/Users/yanxu/tutoring/src/lib/discordSync.ts"
    with open(path, "r") as f:
        content = f.read()

    # Rename variables
    content = content.replace('const defaultCommunityCategoryName = "Community";', 'const defaultTextCategoryName = "Text";\nconst defaultVoiceCategoryName = "Voice";')
    content = content.replace('defaultCommunityCategoryName', 'defaultTextCategoryName')
    content = content.replace('communityCategoryName', 'textCategoryName')
    content = content.replace('communityCategory', 'textCategory')
    content = content.replace('DISCORD_COMMUNITY_CATEGORY_NAME', 'DISCORD_TEXT_CATEGORY_NAME')
    
    # Remove founder-only, replace tutor-only
    content = content.replace('const defaultFounderOnlyChannelName = "founder-only";', '')
    content = content.replace('const defaultTutorOnlyChannelName = "tutor-only";', 
        'const defaultExecutivesOnlyChannelName = "executives";\n'
        'const defaultSocialMediaChannelName = "social-media";\n'
        'const defaultScienceTutorsChannelName = "science-tutors";'
    )
    # Remove tutor VC, add new voice channels
    content = content.replace('const defaultTutorVoiceChannelName = "Tutor VC";',
        'const defaultEveryoneVoiceChannelName = "Everyone";\n'
        'const defaultExecutivesVoiceChannelName = "Executives";\n'
        'const defaultSocialMediaVoiceChannelName = "Social Media";\n'
        'const defaultScienceTutorsVoiceChannelName = "Science Tutors";'
    )

    # Rename constants usages
    content = content.replace('defaultTutorOnlyChannelName', 'defaultExecutivesOnlyChannelName')
    content = content.replace('tutorOnlyChannelName', 'executivesOnlyChannelName')
    content = content.replace('tutorOnlyChannel', 'executivesOnlyChannel')
    content = content.replace('DISCORD_TUTOR_ONLY_CHANNEL_NAME', 'DISCORD_EXECUTIVES_ONLY_CHANNEL_NAME')

    content = content.replace('defaultTutorVoiceChannelName', 'defaultExecutivesVoiceChannelName')
    content = content.replace('tutorVoiceChannelName', 'executivesVoiceChannelName')
    content = content.replace('tutorVoiceChannel', 'executivesVoiceChannel')
    content = content.replace('DISCORD_TUTOR_VOICE_CHANNEL_NAME', 'DISCORD_EXECUTIVES_VOICE_CHANNEL_NAME')
    
    # Rename variables in the function
    content = content.replace('const founderOnlyChannelName =\n    String(process.env.DISCORD_FOUNDER_ONLY_CHANNEL_NAME ?? "").trim() ||\n    defaultFounderOnlyChannelName;', '')
    content = content.replace('const founderOnlyChannelName =\n    String(process.env.DISCORD_FOUNDER_ONLY_CHANNEL_NAME ?? "").trim() ||\n    "founder-only";', '')

    # Roles
    content = content.replace('const tutorRole = await ensureRole("Tutor", false);', 'const executiveRole = await ensureRole("Executive", false);\n  const socialMediaRole = await ensureRole("Social Media", false);\n  const scienceTutorsRole = await ensureRole("Science Tutors", false);')
    content = content.replace('tutorRole.id', 'executiveRole.id')
    content = content.replace('const baseRoleIds = new Set([studentRole.id, executiveRole.id, founderRole.id]);', 'const baseRoleIds = new Set([studentRole.id, executiveRole.id, founderRole.id, socialMediaRole.id, scienceTutorsRole.id]);')
    content = content.replace('shouldBeTutor', 'shouldBeExecutive')
    content = content.replace('websiteRole === "tutor"', 'websiteRole === "executive"')

    # Fix Permissions builders
    content = content.replace('buildTutorOnlyPermissionOverwrites', 'buildExecutivesOnlyPermissionOverwrites')
    content = content.replace('tutorRoleId', 'executiveRoleId')
    content = content.replace('buildTutorVoicePermissionOverwrites', 'buildExecutivesVoicePermissionOverwrites')
    content = content.replace('buildFounderOnlyPermissionOverwrites', 'buildGenericPermissionOverwrites')

    with open(path, "w") as f:
        f.write(content)

if __name__ == "__main__":
    modify_discordSync()
