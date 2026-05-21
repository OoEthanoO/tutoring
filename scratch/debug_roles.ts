import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordGuildId = process.env.DISCORD_GUILD_ID;

if (!supabaseUrl || !serviceRoleKey || !discordBotToken || !discordGuildId) {
  console.error("Missing env vars in .env.local");
  process.exit(1);
}

async function request(path: string) {
  const url = `https://discord.com/api/v10${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bot ${discordBotToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function run() {
  const mutableRoles: any[] = await request(`/guilds/${discordGuildId}/roles`);
  const mutableChannels: any[] = await request(`/guilds/${discordGuildId}/channels`);

  console.log("=== All Discord Roles ===");
  for (const role of mutableRoles) {
    console.log(`- Role: "${role.name}" (ID: ${role.id}), Position: ${role.position}, Managed: ${role.managed}`);
  }

  console.log("\n=== All Discord Channels ===");
  for (const channel of mutableChannels) {
    console.log(`- Channel: "${channel.name}" (ID: ${channel.id}), Type: ${channel.type}, Parent ID: ${channel.parent_id}, Topic: ${channel.topic}`);
  }
}

run().catch(console.error);
