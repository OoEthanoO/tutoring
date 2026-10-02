/** Bind only voice/connection events; unrelated Discord activity does no work. */
export function watchZenVoice(client, events, guildId, ready, queue, onChange) {
  const catchUp = () => {
    if (!ready()) return;
    for (const voice of client.guilds.cache.get(guildId).voiceStates.cache.values()) {
      if (voice.channelId) queue.add(voice.id);
    }
  };
  client.on(events.VoiceStateUpdate, (before, after) => {
    if (after.guild.id !== guildId) return;
    if (before.channelId === after.channelId && before.serverMute === after.serverMute) return;
    onChange();
    queue.add(after.id);
  });
  client.on(events.ClientReady, catchUp);
  client.on(events.GuildAvailable, catchUp);
  client.on(events.GuildCreate, catchUp);
  client.on(events.ShardResume, catchUp);
  // The library updates its aggregate ready status after emitting shardReady.
  client.on(events.ShardReady, () => setImmediate(catchUp));
}
