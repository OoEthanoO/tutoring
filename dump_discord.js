const { DiscordApiClient } = require("./src/lib/discordApi.js");
require("dotenv").config({ path: ".env.local" });

async function run() {
  const client = new DiscordApiClient(process.env.DISCORD_BOT_TOKEN);
  const guildId = process.env.DISCORD_GUILD_ID;
  
  const roles = await client.listGuildRoles(guildId);
  console.log("ROLES:");
  roles.forEach(r => console.log(r.id, r.name));
  
  const channels = await client.listGuildChannels(guildId);
  console.log("\nCHANNELS:");
  channels.forEach(c => {
    if (c.name.includes("java")) {
      console.log(c.id, c.name, c.topic);
      console.log("  Overwrites:", c.permission_overwrites);
    }
  });
}
run();
