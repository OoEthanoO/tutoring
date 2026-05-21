const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const discordGuildId = process.env.DISCORD_GUILD_ID;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  console.log("--- DATABASE COURSES ---");
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, is_completed, created_at, created_by")
    .ilike("title", "%Curriculum Math%");
  
  if (error) {
    console.error("DB Error:", error);
  } else {
    console.log(JSON.stringify(courses, null, 2));
  }

  const headers = { Authorization: `Bot ${discordBotToken}` };

  console.log("\n--- DISCORD ROLES ---");
  const rolesResponse = await fetch(`https://discord.com/api/v10/guilds/${discordGuildId}/roles`, { headers });
  const roles = await rolesResponse.json();
  if (Array.isArray(roles)) {
    const mathRoles = roles.filter(r => r.name.toLowerCase().includes("math"));
    mathRoles.forEach(r => {
      console.log(`Role ID: ${r.id} | Name: "${r.name}" | Managed: ${r.managed}`);
    });
  } else {
    console.error("Error fetching roles:", roles);
  }

  console.log("\n--- DISCORD CHANNELS (matching 'math') ---");
  const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${discordGuildId}/channels`, { headers });
  const channels = await channelsResponse.json();
  if (Array.isArray(channels)) {
    const mathChannels = channels.filter(c => c.name.toLowerCase().includes("math") || (c.topic && c.topic.toLowerCase().includes("math")));
    mathChannels.forEach(c => {
      console.log(`Channel ID: ${c.id} | Name: "${c.name}" | Topic: "${c.topic}"`);
      console.log("  Permission Overwrites:", JSON.stringify(c.permission_overwrites, null, 2));
    });
  } else {
    console.error("Error fetching channels:", channels);
  }
}

run();
