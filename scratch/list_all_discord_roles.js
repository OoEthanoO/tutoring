require("dotenv").config({ path: ".env.local" });
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordGuildId = process.env.DISCORD_GUILD_ID;

async function run() {
  const headers = { Authorization: `Bot ${discordBotToken}` };
  const rolesResponse = await fetch(`https://discord.com/api/v10/guilds/${discordGuildId}/roles`, { headers });
  const roles = await rolesResponse.json();
  if (Array.isArray(roles)) {
    console.log("All Discord Roles:");
    roles.forEach(r => {
      if (!r.managed) {
        console.log(`Role ID: ${r.id} | Name: "${r.name}"`);
      }
    });
  } else {
    console.error("Error fetching roles:", roles);
  }
}

run();
