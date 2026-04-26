require("dotenv").config({ path: ".env.local" });

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

async function run() {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` }
  });
  const channels = await res.json();
  
  let oldChannel = channels.find(c => c.name === "java-beginner");
  let newChannel = channels.find(c => c.name === "introduction-to-java");
  
  console.log("Old Channel:", oldChannel.id, oldChannel.topic);
  console.log("New Channel:", newChannel.id, newChannel.topic);
  
  // Swap topics
  await fetch(`https://discord.com/api/v10/channels/${oldChannel.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topic: newChannel.topic })
  });
  
  await fetch(`https://discord.com/api/v10/channels/${newChannel.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topic: oldChannel.topic })
  });
  
  console.log("Swapped!");
}
run();
