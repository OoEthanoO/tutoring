import { Client, Events, GatewayIntentBits, Status } from "discord.js";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { ZenVoiceQueue } from "./zen-voice-queue.mjs";
import { watchZenVoice } from "./zen-voice-events.mjs";

const root = process.env.YANLEARN_RUNTIME_ROOT;
const token = process.env.DISCORD_BOT_TOKEN;
const secret = process.env.CRON_SECRET;
const guildId = process.env.DISCORD_GUILD_ID;
const commit = process.env.YANLEARN_COMMIT_SHA;
const port = Number(process.env.YANLEARN_ZEN_GATEWAY_PORT || 3102);
const probe = process.argv.includes("--probe");
if (!root || !token || !secret || !guildId || !commit) throw new Error("Missing Zen worker configuration.");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Zen worker port.");

// No message, presence or privileged member intent. discord.js owns heartbeats,
// sequence/resume handling, reconnects and Gateway session-start rate limits.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const active = async () => JSON.parse((await readFile(path.join(root, "active.json"), "utf8")).replace(/^\uFEFF/, ""));
const ready = () => client.isReady() && client.ws.status === Status.Ready && client.guilds.cache.get(guildId)?.available === true;
let lastEventAt = null;
let lastAppliedAt = null;
let lastError = null;
let stopping = false;
let writingStatus = false;

const queue = new ZenVoiceQueue(async memberIds => {
  if (!ready()) throw new Error("Discord Gateway is reconnecting.");
  const state = await active();
  if (![3100, 3101].includes(state.port)) throw new Error("Invalid active website port.");
  const response = await fetch(`http://127.0.0.1:${state.port}/api/internal/zen-voice`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ memberIds }), signal: AbortSignal.timeout(55000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Zen voice update returned HTTP ${response.status}.`);
  lastAppliedAt = new Date().toISOString();
  lastError = null;
}, error => { lastError = error.message; });

if (!probe) watchZenVoice(client, Events, guildId, ready, queue, () => {
  lastEventAt = new Date().toISOString();
});
client.on(Events.Error, () => { lastError = "Discord Gateway connection error."; });
client.on(Events.ShardError, () => { lastError = "Discord Gateway connection error."; });

const server = createServer((request, response) => {
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const authorized = actual.length === expected.length && timingSafeEqual(actual, expected);
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (!authorized) { response.writeHead(401).end('{"error":"Unauthorized"}'); return; }
  if (request.method !== "GET" || request.url !== "/voice-members") { response.writeHead(404).end("{}"); return; }
  if (!ready()) { response.writeHead(503).end('{"ready":false}'); return; }
  const memberIds = [...client.guilds.cache.get(guildId).voiceStates.cache.values()].filter(v => v.channelId).map(v => v.id);
  response.end(JSON.stringify({ ready: true, memberIds }));
});
server.on("error", () => { console.error("Zen worker could not bind its private listener."); process.exit(1); });
if (!probe) server.listen(port, "127.0.0.1");

async function status() {
  if (writingStatus || stopping) return;
  writingStatus = true;
  try {
    if ((await active()).commit !== commit) { await stop(); return; }
    const statusPath = path.join(root, "zen-gateway-status.json");
    await writeFile(statusPath + ".new", JSON.stringify({ commit, pid: process.pid, ready: ready(),
      updatedAt: new Date().toISOString(), lastEventAt, lastAppliedAt, pending: queue.pending.size,
      processing: queue.running, lastError }));
    await rename(statusPath + ".new", statusPath);
  } catch { console.error("Could not update Zen worker status."); }
  finally { writingStatus = false; }
}
const timer = probe ? setTimeout(() => {
  console.error("Discord Gateway probe timed out."); process.exit(1);
}, 30000) : setInterval(() => void status(), 5000);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  queue.stop();
  await client.destroy();
  server.close();
  // The Windows supervisor launches the active release after this exits.
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
if (probe) client.once(Events.ClientReady, async () => {
  console.log(JSON.stringify({ ready: ready(), connectedMembers: client.guilds.cache.get(guildId)?.voiceStates.cache.size ?? 0 }));
  const code = ready() ? 0 : 1;
  await client.destroy();
  process.exit(code);
});
void client.login(token).then(() => { if (!probe) return status(); }).catch(() => {
  console.error("Discord Gateway login failed; check the bot credentials and enabled intents.");
  process.exit(1);
});
