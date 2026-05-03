const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordGuildId = process.env.DISCORD_GUILD_ID;
fetch(`https://discord.com/api/v10/guilds/${discordGuildId}/roles`, {
    headers: { Authorization: `Bot ${discordBotToken}` }
}).then(r => r.json()).then(roles => {
    const founderRole = roles.find(r => r.name === "Founder");
    console.log(founderRole ? founderRole.id : "Not found");
})
